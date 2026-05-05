import { Router } from "express";
import { supa } from "../lib/supabase.js";
import { requireSupabaseAuth, requireAuth } from "../lib/auth.js";

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

router.post("/api/pod/otp/send", requireAuth, async (req, res) => {
  const { farmerId } = req.body as { farmerId: number };
  if (!farmerId) {
    res.status(400).json({ error: "farmerId is required" });
    return;
  }

  const { data: farmers } = await supa.from("farmers").select("id,first_name,last_name,phone").eq("id", Number(farmerId)).limit(1);
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
  otpStore.set(String(farmerId), { code, expiresAt: Date.now() + 5 * 60 * 1000, attempts: 0 });

  const twilioSid = process.env.TWILIO_ACCOUNT_SID;
  const twilioAuth = process.env.TWILIO_AUTH_TOKEN;
  const twilioFrom = process.env.TWILIO_PHONE_NUMBER;

  const isDev = process.env.NODE_ENV !== "production";
  let smsSent = false;

  if (twilioSid && twilioAuth && twilioFrom) {
    try {
      const { default: twilio } = await import("twilio");
      const client = twilio(twilioSid, twilioAuth);
      const msg = await client.messages.create({
        body: `Agri-PoD Verification Code: ${code}\nDo not share this code. Valid for 5 minutes.\n- AVDP Sierra Leone`,
        from: twilioFrom,
        to: farmer.phone,
      });
      smsSent = true;
      req.log.info({ messageSid: msg.sid, to: farmer.phone, status: msg.status }, "Twilio SMS sent");
    } catch (err: any) {
      req.log.error({ err: err.message }, "Twilio SMS send failed");
      // In dev, continue anyway so testing works; in prod, fail hard
      if (!isDev) {
        res.status(502).json({ error: "Failed to send SMS. Please check the farmer's phone number." });
        return;
      }
    }
  } else {
    req.log.warn({ farmerId, code }, "Twilio not configured — OTP in devCode");
  }

  res.json({
    sent: true,
    smsSent,
    maskedPhone: maskPhone(farmer.phone),
    farmerName: `${farmer.first_name} ${farmer.last_name}`,
    // Always expose code in dev so testing works even on trial Twilio accounts
    devCode: isDev ? code : undefined,
  });
});

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
