import { Router } from "express";
import { createHash } from "crypto";
import { supa } from "../lib/supabase.js";
import { requireAnyAuth } from "../lib/auth.js";

const router = Router();

function normalisePhone(raw: string): string {
  let p = raw.replace(/[\s\-().]/g, "");
  if (p.startsWith("+"))  p = p.slice(1);
  if (p.startsWith("00")) p = p.slice(2);
  if (p.startsWith("0") && p.length === 9) p = "232" + p.slice(1);
  return p;
}

function maskPhone(phone: string): string {
  const norm = normalisePhone(phone);
  return norm.replace(/\d(?=\d{4})/g, "*");
}

function hashCode(code: string): string {
  return createHash("sha256").update(code).digest("hex");
}

async function sendSms(to: string, text: string): Promise<void> {
  const username = process.env.EASYSENDSMS_USERNAME;
  const password = process.env.EASYSENDSMS_PASSWORD;
  const sender   = process.env.EASYSENDSMS_SENDER ?? "AgriPoD";

  if (!username || !password) {
    throw new Error("EasySendSMS credentials not configured (EASYSENDSMS_USERNAME / EASYSENDSMS_PASSWORD)");
  }

  const params = new URLSearchParams({
    username,
    password,
    from: sender,
    to:   normalisePhone(to),
    text,
    type: "0",
  });

  const resp = await fetch(`https://api.easysendsms.app/bulksms?${params}`, { method: "GET" });
  const body = (await resp.text()).trim();

  if (!body.toUpperCase().startsWith("OK:")) {
    throw new Error(`EasySendSMS error: ${body}`);
  }
}

async function dbGetActive(farmerId: number) {
  const { data, error } = await supa
    .from("otp_codes")
    .select("*")
    .eq("farmer_id", farmerId)
    .gt("expires_at", new Date().toISOString())
    .order("created_at", { ascending: false })
    .limit(1)
    .single();
  if (error) return null;
  return data ?? null;
}

async function dbInsert(farmerId: number, codeHash: string, channel: string) {
  await supa.from("otp_codes").delete().eq("farmer_id", farmerId);
  const expiresAt = new Date(Date.now() + 10 * 60 * 1000).toISOString();
  const { data } = await supa
    .from("otp_codes")
    .insert({ farmer_id: farmerId, code_hash: codeHash, channel, expires_at: expiresAt, attempts: 0 })
    .select()
    .single();
  return data;
}

async function dbIncrementAttempts(id: number, attempts: number) {
  await supa.from("otp_codes").update({ attempts }).eq("id", id);
}

async function dbDeleteCode(id: number) {
  await supa.from("otp_codes").delete().eq("id", id);
}

setInterval(async () => {
  await supa.from("otp_codes").delete().lt("expires_at", new Date().toISOString());
}, 15 * 60 * 1000);

router.post("/api/pod/otp/send", requireAnyAuth, async (req, res) => {
  const { farmerId } = req.body as { farmerId: number };
  if (!farmerId) {
    res.status(400).json({ error: "farmerId is required" });
    return;
  }

  const { data: farmer, error: farmerErr } = await supa
    .from("farmers")
    .select("id, first_name, last_name, phone")
    .eq("id", Number(farmerId))
    .single();

  if (farmerErr || !farmer) {
    res.status(404).json({ error: "Farmer not found" });
    return;
  }

  const f = farmer as any;
  if (!f.phone) {
    res.status(400).json({ error: "Farmer has no registered phone number" });
    return;
  }

  const existing = await dbGetActive(Number(farmerId));
  if (existing) {
    const elapsedSec = Math.floor((Date.now() - new Date((existing as any).created_at).getTime()) / 1000);
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

  const code    = Math.floor(100000 + Math.random() * 900000).toString();
  const isDev   = process.env.NODE_ENV !== "production";
  const message = `Agri-PoD code: ${code}. Valid 10 min. Do not share. — Invendis SL`;

  let channel = "none";

  try {
    await sendSms(f.phone, message);
    channel = "sms";
    req.log.info({ to: f.phone }, "OTP sent via EasySendSMS");
  } catch (err: any) {
    req.log.warn({ err: err.message }, "EasySendSMS delivery failed");
    if (!isDev) {
      res.status(502).json({
        error: "Could not deliver verification code — SMS delivery failed. Please try again.",
      });
      return;
    }
    req.log.info("Dev mode: OTP not sent to handset, devCode returned instead");
  }

  await dbInsert(Number(farmerId), hashCode(code), channel);

  res.json({
    sent:        true,
    smsSent:     channel === "sms",
    channel,
    maskedPhone: maskPhone(f.phone),
    farmerName:  `${f.first_name} ${f.last_name}`,
    devCode: isDev ? code : undefined,
  });
});

router.post("/api/pod/otp/verify", requireAnyAuth, async (req, res) => {
  const { farmerId, code } = req.body as { farmerId: number; code: string };
  if (!farmerId || !code) {
    res.status(400).json({ verified: false, error: "farmerId and code are required" });
    return;
  }

  const entry = await dbGetActive(Number(farmerId));
  if (!entry) {
    res.status(400).json({
      verified: false,
      error: "No active OTP found. Please request a new code.",
    });
    return;
  }

  const e = entry as any;
  const newAttempts = (e.attempts ?? 0) + 1;

  if (newAttempts > 5) {
    await dbDeleteCode(e.id);
    res.status(400).json({
      verified: false,
      error: "Too many incorrect attempts. Please request a new code.",
    });
    return;
  }

  if (hashCode(code.trim()) !== e.code_hash) {
    await dbIncrementAttempts(e.id, newAttempts);
    const remaining = 5 - newAttempts;
    res.status(400).json({
      verified: false,
      error: remaining > 0
        ? `Incorrect code. ${remaining} attempt${remaining !== 1 ? "s" : ""} remaining.`
        : "Too many incorrect attempts. Please request a new code.",
    });
    return;
  }

  await dbDeleteCode(e.id);
  res.json({ verified: true });
});

export default router;
