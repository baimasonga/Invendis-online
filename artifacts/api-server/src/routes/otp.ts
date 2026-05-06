import { Router } from "express";
import { createHash } from "crypto";
import { supa } from "../lib/supabase.js";
import { requireAnyAuth } from "../lib/auth.js";

const router = Router();

// ── Phone normalisation ───────────────────────────────────────────────────────
// Converts any common Sierra Leone phone format to international digits (no +).
// Examples:
//   076123456   (local, leading 0)  → 23276123456
//   +23276123456 (E.164)            → 23276123456
//   0023276123456 (00-prefixed)     → 23276123456
//   23276123456  (already intl)     → 23276123456

function normalisePhone(raw: string): string {
  let p = raw.replace(/[\s\-().]/g, ""); // strip formatting
  if (p.startsWith("+"))  p = p.slice(1);
  if (p.startsWith("00")) p = p.slice(2);
  // Local Sierra Leone format: starts with 0 and 9 digits → prepend 232, drop leading 0
  if (p.startsWith("0") && p.length === 9) p = "232" + p.slice(1);
  return p;
}

function maskPhone(phone: string): string {
  const norm = normalisePhone(phone);
  return norm.replace(/\d(?=\d{4})/g, "*");
}

// ── Code hashing ─────────────────────────────────────────────────────────────

function hashCode(code: string): string {
  return createHash("sha256").update(code).digest("hex");
}

// ── SMS senders ──────────────────────────────────────────────────────────────

async function sendViaEasySendSms(to: string, text: string): Promise<string> {
  const username = process.env.EASYSENDSMS_USERNAME;
  const password = process.env.EASYSENDSMS_PASSWORD;
  const sender   = process.env.EASYSENDSMS_SENDER ?? "AgriPoD";
  if (!username || !password) throw new Error("EasySendSMS credentials not set");

  const params = new URLSearchParams({
    username, password, from: sender,
    to: normalisePhone(to), text, type: "0",
  });
  const resp = await fetch(`https://api.easysendsms.app/bulksms?${params}`, { method: "GET" });
  const body = (await resp.text()).trim();
  if (!body.toUpperCase().startsWith("OK:")) throw new Error(`EasySendSMS error: ${body}`);
  return body.slice(4).trim();
}

async function sendViaTwilio(to: string, text: string): Promise<string> {
  const sid    = process.env.TWILIO_ACCOUNT_SID;
  const token  = process.env.TWILIO_AUTH_TOKEN;
  const from   = process.env.TWILIO_PHONE_NUMBER;
  if (!sid || !token || !from) throw new Error("Twilio credentials not set");

  const body = new URLSearchParams({
    To:   `+${normalisePhone(to)}`,
    From: from,
    Body: text,
  });
  const resp = await fetch(
    `https://api.twilio.com/2010-04-01/Accounts/${sid}/Messages.json`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        Authorization: `Basic ${Buffer.from(`${sid}:${token}`).toString("base64")}`,
      },
      body,
    }
  );
  const json = await resp.json() as any;
  if (!resp.ok) throw new Error(`Twilio error: ${json?.message ?? resp.status}`);
  return json.sid as string;
}

// ── DB helpers ────────────────────────────────────────────────────────────────
// All OTP codes live in the `otp_codes` table so they survive server restarts.
// Columns: id, farmer_id, code_hash, channel, expires_at, attempts, created_at

async function dbGetActive(farmerId: number) {
  const { data } = await supa
    .from("otp_codes")
    .select("*")
    .eq("farmer_id", farmerId)
    .gt("expires_at", new Date().toISOString())
    .order("created_at", { ascending: false })
    .limit(1);
  return data?.[0] ?? null;
}

async function dbInsert(farmerId: number, codeHash: string, channel: string) {
  // Delete any old codes for this farmer first
  await supa.from("otp_codes").delete().eq("farmer_id", farmerId);
  const expiresAt = new Date(Date.now() + 10 * 60 * 1000).toISOString(); // 10 min
  const { data, error } = await supa
    .from("otp_codes")
    .insert({ farmer_id: farmerId, code_hash: codeHash, channel, expires_at: expiresAt, attempts: 0 })
    .select()
    .single();
  if (error) throw new Error(`DB insert failed: ${error.message}`);
  return data;
}

async function dbIncrementAttempts(id: number, attempts: number) {
  await supa.from("otp_codes").update({ attempts }).eq("id", id);
}

async function dbDeleteCode(id: number) {
  await supa.from("otp_codes").delete().eq("id", id);
}

// ── Periodic cleanup of expired rows (every 15 min) ──────────────────────────
setInterval(async () => {
  await supa.from("otp_codes").delete().lt("expires_at", new Date().toISOString());
}, 15 * 60 * 1000);

// ── POST /api/pod/otp/send ────────────────────────────────────────────────────

router.post("/api/pod/otp/send", requireAnyAuth, async (req, res) => {
  const { farmerId } = req.body as { farmerId: number };
  if (!farmerId) {
    res.status(400).json({ error: "farmerId is required" });
    return;
  }

  // Look up farmer
  const { data: farmers } = await supa
    .from("farmers")
    .select("id,first_name,last_name,phone")
    .eq("id", Number(farmerId))
    .limit(1);
  const farmer = farmers?.[0];
  if (!farmer) { res.status(404).json({ error: "Farmer not found" }); return; }
  if (!farmer.phone) { res.status(400).json({ error: "Farmer has no registered phone number" }); return; }

  // Rate limiting: one send per 60 s
  const existing = await dbGetActive(Number(farmerId));
  if (existing) {
    const createdMs  = new Date(existing.created_at).getTime();
    const elapsedSec = Math.floor((Date.now() - createdMs) / 1000);
    const cooldown   = 60;
    if (elapsedSec < cooldown) {
      const retryAfterSeconds = cooldown - elapsedSec;
      res.status(429).json({
        error: `Please wait ${retryAfterSeconds}s before requesting a new code.`,
        retryAfterSeconds,
      });
      return;
    }
  }

  // Generate code
  const code    = Math.floor(100000 + Math.random() * 900000).toString();
  const isDev   = process.env.NODE_ENV !== "production";
  const message =
    `Agri-PoD code: ${code}. Valid 10 min. Do not share. — Invendis SL`;

  // Try to send SMS (EasySendSMS → Twilio fallback)
  let channel   = "none";
  let messageId: string | undefined;
  const easySmsConfigured = !!process.env.EASYSENDSMS_USERNAME && !!process.env.EASYSENDSMS_PASSWORD;
  const twilioConfigured  = !!process.env.TWILIO_ACCOUNT_SID  && !!process.env.TWILIO_AUTH_TOKEN;

  if (easySmsConfigured) {
    try {
      messageId = await sendViaEasySendSms(farmer.phone, message);
      channel   = "sms";
      req.log.info({ messageId, to: farmer.phone, channel: "EasySendSMS" }, "OTP sent");
    } catch (err: any) {
      req.log.warn({ err: err.message }, "EasySendSMS failed — trying Twilio");
    }
  }

  if (channel === "none" && twilioConfigured) {
    try {
      messageId = await sendViaTwilio(farmer.phone, message);
      channel   = "sms";
      req.log.info({ messageId, to: farmer.phone, channel: "Twilio" }, "OTP sent via Twilio fallback");
    } catch (err: any) {
      req.log.warn({ err: err.message }, "Twilio also failed");
    }
  }

  if (channel === "none" && !isDev) {
    res.status(502).json({ error: "Could not deliver verification code. Please try again." });
    return;
  }

  // Persist to DB
  await dbInsert(Number(farmerId), hashCode(code), channel);

  res.json({
    sent: true,
    smsSent: channel === "sms",
    channel,
    maskedPhone: maskPhone(farmer.phone),
    farmerName: `${farmer.first_name} ${farmer.last_name}`,
    devCode: isDev ? code : undefined,
  });
});

// ── POST /api/pod/otp/verify ──────────────────────────────────────────────────

router.post("/api/pod/otp/verify", requireAnyAuth, async (req, res) => {
  const { farmerId, code } = req.body as { farmerId: number; code: string };
  if (!farmerId || !code) {
    res.status(400).json({ verified: false, error: "farmerId and code are required" });
    return;
  }

  const entry = await dbGetActive(Number(farmerId));
  if (!entry) {
    res.status(400).json({ verified: false, error: "No active OTP found. Please request a new code." });
    return;
  }

  const newAttempts = (entry.attempts ?? 0) + 1;

  if (newAttempts > 5) {
    await dbDeleteCode(entry.id);
    res.status(400).json({ verified: false, error: "Too many incorrect attempts. Please request a new code." });
    return;
  }

  if (hashCode(code.trim()) !== entry.code_hash) {
    await dbIncrementAttempts(entry.id, newAttempts);
    const remaining = 5 - newAttempts;
    res.status(400).json({
      verified: false,
      error: remaining > 0
        ? `Incorrect code. ${remaining} attempt${remaining !== 1 ? "s" : ""} remaining.`
        : "Too many incorrect attempts. Please request a new code.",
    });
    return;
  }

  await dbDeleteCode(entry.id);
  res.json({ verified: true });
});

export default router;
