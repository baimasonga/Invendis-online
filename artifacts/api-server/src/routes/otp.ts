import { Router } from "express";
import { createHash } from "crypto";
import { pool } from "../lib/db.js";
import { requireAnyAuth } from "../lib/auth.js";
import { validateBody, OtpSendSchema, OtpVerifySchema } from "../lib/validate.js";

const router = Router();

// ── Phone normalisation ───────────────────────────────────────────────────────
// Converts any common Sierra Leone phone format to international digits (no +).
//   076123456    (local, leading 0)  → 23276123456
//   +23276123456 (E.164)             → 23276123456
//   0023276123456 (00-prefixed)      → 23276123456
//   23276123456  (already intl)      → 23276123456
function normalisePhone(raw: string): string {
  let p = raw.replace(/[\s\-().]/g, "");
  if (p.startsWith("+"))  p = p.slice(1);
  if (p.startsWith("00")) p = p.slice(2);
  // Local SL format: starts with 0, 9 digits total → strip leading 0, prepend 232
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

// ── EasySendSMS ──────────────────────────────────────────────────────────────
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

  // EasySendSMS returns "OK: <msgid>" on success
  if (!body.toUpperCase().startsWith("OK:")) {
    throw new Error(`EasySendSMS error: ${body}`);
  }
}

// ── DB helpers (direct pg — bypasses PostgREST schema cache) ─────────────────

async function dbGetActive(farmerId: number) {
  const { rows } = await pool.query(
    `SELECT * FROM otp_codes
      WHERE farmer_id = $1 AND expires_at > NOW()
      ORDER BY created_at DESC LIMIT 1`,
    [farmerId],
  );
  return rows[0] ?? null;
}

async function dbInsert(farmerId: number, codeHash: string, channel: string) {
  // Delete any previous codes for this farmer first
  await pool.query("DELETE FROM otp_codes WHERE farmer_id = $1", [farmerId]);
  const expiresAt = new Date(Date.now() + 10 * 60 * 1000); // 10 min
  const { rows } = await pool.query(
    `INSERT INTO otp_codes (farmer_id, code_hash, channel, expires_at, attempts)
     VALUES ($1, $2, $3, $4, 0) RETURNING *`,
    [farmerId, codeHash, channel, expiresAt],
  );
  return rows[0];
}

async function dbIncrementAttempts(id: number, attempts: number) {
  await pool.query("UPDATE otp_codes SET attempts = $1 WHERE id = $2", [attempts, id]);
}

async function dbDeleteCode(id: number) {
  await pool.query("DELETE FROM otp_codes WHERE id = $1", [id]);
}

// Clean up expired rows every 15 minutes
setInterval(async () => {
  await pool.query("DELETE FROM otp_codes WHERE expires_at < NOW()");
}, 15 * 60 * 1000);

// ── POST /api/pod/otp/send ────────────────────────────────────────────────────

router.post("/api/pod/otp/send", requireAnyAuth, validateBody(OtpSendSchema), async (req, res) => {
  const { farmerId } = req.body as { farmerId: number };

  // Look up farmer via direct pg (no Supabase REST)
  const { rows: farmers } = await pool.query(
    "SELECT id, first_name, last_name, phone FROM farmers WHERE id = $1 LIMIT 1",
    [Number(farmerId)],
  );
  const farmer = farmers[0];
  if (!farmer) {
    res.status(404).json({ error: "Farmer not found" });
    return;
  }
  if (!farmer.phone) {
    res.status(400).json({ error: "Farmer has no registered phone number" });
    return;
  }

  // Rate limit: one send every 60 seconds per farmer
  const existing = await dbGetActive(Number(farmerId));
  if (existing) {
    const elapsedSec = Math.floor((Date.now() - new Date(existing.created_at).getTime()) / 1000);
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

  // Generate 6-digit code
  const code    = Math.floor(100000 + Math.random() * 900000).toString();
  const isDev   = process.env.NODE_ENV !== "production";
  const message = `Agri-PoD code: ${code}. Valid 10 min. Do not share. — Invendis SL`;

  let channel = "none";

  try {
    await sendSms(farmer.phone, message);
    channel = "sms";
    req.log.info({ to: farmer.phone }, "OTP sent via EasySendSMS");
  } catch (err: any) {
    req.log.warn({ err: err.message }, "EasySendSMS delivery failed");
    if (!isDev) {
      res.status(502).json({
        error: "Could not deliver verification code — SMS delivery failed. Please try again.",
      });
      return;
    }
    // In dev, log the code server-side only — never return it in the response
    req.log.info({ farmerId, code }, "Dev mode: SMS not sent; OTP logged here for testing");
  }

  // Persist to DB
  await dbInsert(Number(farmerId), hashCode(code), channel);

  res.json({
    sent:        true,
    smsSent:     channel === "sms",
    channel,
    maskedPhone: maskPhone(farmer.phone),
    farmerName:  `${farmer.first_name} ${farmer.last_name}`,
  });
});

// ── POST /api/pod/otp/verify ──────────────────────────────────────────────────

router.post("/api/pod/otp/verify", requireAnyAuth, validateBody(OtpVerifySchema), async (req, res) => {
  const { farmerId, code } = req.body as { farmerId: number; code: string };

  const entry = await dbGetActive(Number(farmerId));
  if (!entry) {
    res.status(400).json({
      verified: false,
      error: "No active OTP found. Please request a new code.",
    });
    return;
  }

  const newAttempts = (entry.attempts ?? 0) + 1;

  // Exceeded 5 wrong guesses — invalidate the code
  if (newAttempts > 5) {
    await dbDeleteCode(entry.id);
    res.status(400).json({
      verified: false,
      error: "Too many incorrect attempts. Please request a new code.",
    });
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

  // Success — consume the code immediately
  await dbDeleteCode(entry.id);
  res.json({ verified: true });
});

export default router;
