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

  // WhatsApp sandbox number — override with TWILIO_WHATSAPP_FROM for approved senders
  const whatsappFrom = process.env.TWILIO_WHATSAPP_FROM ?? "whatsapp:+14155238886";
  let channel: "whatsapp" | "sms" | "none" = "none";

  if (twilioSid && twilioAuth && twilioFrom) {
    const { default: twilio } = await import("twilio");
    const client = twilio(twilioSid, twilioAuth);

    // Try WhatsApp first
    try {
      const msg = await client.messages.create({
        body: `*Agri-PoD Verification*\n\nYour delivery verification code is:\n\n*${code}*\n\nValid for 5 minutes. Do not share this code.\n— AVDP Sierra Leone`,
        from: whatsappFrom,
        to: `whatsapp:${farmer.phone}`,
      });
      smsSent = true;
      channel = "whatsapp";
      req.log.info({ messageSid: msg.sid, to: farmer.phone, channel: "whatsapp", status: msg.status }, "WhatsApp OTP sent");
    } catch (waErr: any) {
      req.log.warn({ err: waErr.message }, "WhatsApp send failed, falling back to SMS");
      // Fall back to plain SMS
      try {
        const msg = await client.messages.create({
          body: `Agri-PoD Verification Code: ${code}\nDo not share this code. Valid for 5 minutes.\n- AVDP Sierra Leone`,
          from: twilioFrom,
          to: farmer.phone,
        });
        smsSent = true;
        channel = "sms";
        req.log.info({ messageSid: msg.sid, to: farmer.phone, channel: "sms", status: msg.status }, "SMS OTP sent");
      } catch (smsErr: any) {
        req.log.error({ err: smsErr.message }, "SMS fallback also failed");
        if (!isDev) {
          res.status(502).json({ error: "Could not send verification code via WhatsApp or SMS." });
          return;
        }
      }
    }
  } else {
    req.log.warn({ farmerId, code }, "Twilio not configured — OTP in devCode");
  }

  res.json({
    sent: true,
    smsSent,
    channel,
    maskedPhone: maskPhone(farmer.phone),
    farmerName: `${farmer.first_name} ${farmer.last_name}`,
    // Always expose code in dev so testing works without verified numbers
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
