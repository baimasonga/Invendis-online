import { Router } from "express";
import { supa } from "../lib/supabase.js";
import { requireAuth } from "../lib/auth.js";

const router = Router();

interface OtpEntry {
  code: string;
  expiresAt: number;
  attempts: number;
}

const otpStore = new Map<string, OtpEntry>();

setInterval(() => {
  const now = Date.now();
  for (const [key, entry] of otpStore.entries()) {
    if (entry.expiresAt < now) otpStore.delete(key);
  }
}, 5 * 60 * 1000);

function maskPhone(phone: string): string {
  return phone.replace(/\d(?=\d{4})/g, "*");
}

/**
 * Normalise a phone number for EasySendSMS:
 *  - Strip leading +  (e.g. +23276123456  → 23276123456)
 *  - Strip leading 00 (e.g. 0023276123456 → 23276123456)
 */
function normalisePhone(phone: string): string {
  return phone.trim().replace(/^\+/, "").replace(/^00/, "");
}

/**
 * Send an SMS via EasySendSMS HTTP API.
 * Returns the message ID on success, throws on failure.
 */
async function sendViaSms(to: string, text: string): Promise<string> {
  const username = process.env.EASYSENDSMS_USERNAME;
  const password = process.env.EASYSENDSMS_PASSWORD;
  const sender   = process.env.EASYSENDSMS_SENDER ?? "AgriPoD";

  if (!username || !password) {
    throw new Error("EASYSENDSMS_USERNAME or EASYSENDSMS_PASSWORD not configured");
  }

  const params = new URLSearchParams({
    username,
    password,
    from: sender,
    to: normalisePhone(to),
    text,
    type: "0",
  });

  const url = `https://api.easysendsms.app/bulksms?${params.toString()}`;
  const resp = await fetch(url, { method: "GET" });
  const body = (await resp.text()).trim();

  if (!body.toUpperCase().startsWith("OK:")) {
    throw new Error(`EasySendSMS error: ${body}`);
  }

  // body format: "OK: <uuid>"
  return body.slice(4).trim();
}

// ── POST /api/pod/otp/send ────────────────────────────────────────────────────

router.post("/api/pod/otp/send", requireAuth, async (req, res) => {
  const { farmerId } = req.body as { farmerId: number };
  if (!farmerId) {
    res.status(400).json({ error: "farmerId is required" });
    return;
  }

  const { data: farmers } = await supa
    .from("farmers")
    .select("id,first_name,last_name,phone")
    .eq("id", Number(farmerId))
    .limit(1);
  const farmer = farmers?.[0];

  if (!farmer) {
    res.status(404).json({ error: "Farmer not found" });
    return;
  }
  if (!farmer.phone) {
    res.status(400).json({ error: "Farmer has no registered phone number" });
    return;
  }

  const code = Math.floor(100000 + Math.random() * 900000).toString();
  otpStore.set(String(farmerId), {
    code,
    expiresAt: Date.now() + 5 * 60 * 1000,
    attempts: 0,
  });

  const isDev = process.env.NODE_ENV !== "production";
  let smsSent = false;
  let messageId: string | undefined;

  const smsConfigured =
    !!process.env.EASYSENDSMS_USERNAME && !!process.env.EASYSENDSMS_PASSWORD;

  if (smsConfigured) {
    const body =
      `Agri-PoD Verification Code: ${code}\n` +
      `Valid for 5 minutes. Do not share this code.\n` +
      `- AVDP Sierra Leone`;
    try {
      messageId = await sendViaSms(farmer.phone, body);
      smsSent = true;
      req.log.info(
        { messageId, to: farmer.phone, channel: "sms" },
        "SMS OTP sent via EasySendSMS"
      );
    } catch (err: any) {
      req.log.error({ err: err.message }, "EasySendSMS send failed");
      if (!isDev) {
        res.status(502).json({ error: "Could not send verification code via SMS." });
        return;
      }
    }
  } else {
    req.log.warn(
      { farmerId, code },
      "EasySendSMS not configured — OTP available in devCode"
    );
  }

  res.json({
    sent: true,
    smsSent,
    channel: smsSent ? "sms" : "none",
    maskedPhone: maskPhone(farmer.phone),
    farmerName: `${farmer.first_name} ${farmer.last_name}`,
    devCode: isDev ? code : undefined,
  });
});

// ── POST /api/pod/otp/verify ──────────────────────────────────────────────────

router.post("/api/pod/otp/verify", requireAuth, async (req, res) => {
  const { farmerId, code } = req.body as { farmerId: number; code: string };
  if (!farmerId || !code) {
    res.status(400).json({ verified: false, error: "farmerId and code are required" });
    return;
  }

  const entry = otpStore.get(String(farmerId));
  if (!entry) {
    res.status(400).json({ verified: false, error: "No OTP found. Please request a new code." });
    return;
  }
  if (entry.expiresAt < Date.now()) {
    otpStore.delete(String(farmerId));
    res.status(400).json({ verified: false, error: "OTP expired. Please request a new code." });
    return;
  }
  entry.attempts += 1;
  if (entry.attempts > 5) {
    otpStore.delete(String(farmerId));
    res.status(400).json({ verified: false, error: "Too many attempts. Please request a new code." });
    return;
  }
  if (entry.code !== code.trim()) {
    res.status(400).json({ verified: false, error: "Invalid code. Please try again." });
    return;
  }

  otpStore.delete(String(farmerId));
  res.json({ verified: true });
});

export default router;
