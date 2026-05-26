import { Router } from "express";
import { createHash } from "crypto";
import { supa } from "../lib/supabase.js";
import { requireAnyAuth } from "../lib/auth.js";
import { logAudit } from "../lib/audit.js";
import { validateBody, OtpSendSchema, OtpVerifySchema } from "../lib/validate.js";

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
  const username = process.env.AT_USERNAME;
  const apiKey   = process.env.AT_API_KEY;
  const sender   = (process.env.AT_SENDER_ID ?? "AgriPoD").slice(0, 11);

  if (!username || !apiKey) {
    throw new Error("Africa's Talking credentials not configured (AT_USERNAME / AT_API_KEY)");
  }

  const e164 = "+" + normalisePhone(to);
  const body = new URLSearchParams({ username, to: e164, message: text, from: sender });

  const resp = await fetch("https://api.africastalking.com/version1/messaging", {
    method: "POST",
    headers: {
      apiKey,
      "Content-Type":  "application/x-www-form-urlencoded",
      "Accept":        "application/json",
    },
    body,
  });

  const json = await resp.json() as {
    SMSMessageData?: { Recipients?: { status: string; number: string }[] };
  };

  if (!resp.ok) {
    throw new Error(`Africa's Talking HTTP error: ${resp.status}`);
  }

  const recipients = json.SMSMessageData?.Recipients ?? [];
  const failed = recipients.filter(r => r.status !== "Success");
  if (recipients.length === 0 || failed.length === recipients.length) {
    throw new Error(
      `Africa's Talking delivery failed: ${failed.map(r => r.status).join(", ") || "no recipients"}`
    );
  }
}

async function dbGetActive(farmerId: number) {
  const { data } = await supa
    .from("otp_codes")
    .select("*")
    .eq("farmer_id", farmerId)
    .gt("expires_at", new Date().toISOString())
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
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

router.post("/api/pod/otp/send", requireAnyAuth, validateBody(OtpSendSchema), async (req, res) => {
  const { farmerId } = req.body as { farmerId: number };
  const { campaignId: rawCampaignId, dispatchId: rawDispatchId } = req.body as {
    campaignId?: number;
    dispatchId?: number;
  };

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

  // Resolve campaignId (from body or via dispatch lookup)
  let campaignId: number | null = rawCampaignId ? Number(rawCampaignId) : null;
  if (!campaignId && rawDispatchId) {
    const { data: disp } = await supa
      .from("dispatches")
      .select("campaign_id")
      .eq("id", Number(rawDispatchId))
      .single();
    campaignId = (disp as any)?.campaign_id ?? null;
  }

  // Build item list for SMS:
  //   If we have a dispatchId → use dispatch_items (actual loaded quantities)
  //   Fall back to campaign_items (planned quantities per farmer)
  let itemsText = "";
  if (rawDispatchId) {
    const { data: dItems } = await supa
      .from("dispatch_items")
      .select("quantity_loaded, input_item_id")
      .eq("dispatch_id", Number(rawDispatchId));
    if (dItems?.length) {
      const itemIds = (dItems as any[]).map(i => i.input_item_id).filter(Boolean);
      const { data: inputItems } = itemIds.length
        ? await supa.from("input_items").select("id,name,unit").in("id", itemIds)
        : { data: [] };
      const inputMap = Object.fromEntries((inputItems ?? []).map((ii: any) => [ii.id, ii]));
      itemsText = (dItems as any[])
        .map(i => {
          const ii = inputMap[i.input_item_id];
          if (!ii) return null;
          const qty = i.quantity_loaded ?? 0;
          return `${ii.name} ${qty}${ii.unit ? " " + ii.unit : ""}`;
        })
        .filter(Boolean)
        .join(", ");
    }
  } else if (campaignId) {
    const { data: cItems } = await supa
      .from("campaign_items")
      .select("quantity_per_farmer, input_item_id")
      .eq("campaign_id", campaignId);
    if (cItems?.length) {
      const itemIds = (cItems as any[]).map(i => i.input_item_id).filter(Boolean);
      const { data: inputItems } = itemIds.length
        ? await supa.from("input_items").select("id,name,unit").in("id", itemIds)
        : { data: [] };
      const inputMap = Object.fromEntries((inputItems ?? []).map((ii: any) => [ii.id, ii]));
      itemsText = (cItems as any[])
        .map(i => {
          const ii = inputMap[i.input_item_id];
          if (!ii) return null;
          const qty = i.quantity_per_farmer ?? 1;
          return `${ii.name} ${qty}${ii.unit ? " " + ii.unit : ""}`;
        })
        .filter(Boolean)
        .join(", ");
    }
  }

  const code  = Math.floor(100000 + Math.random() * 900000).toString();
  const isDev = process.env.NODE_ENV === "development";
  const message = itemsText
    ? `AVDP PoD code: ${code}. Items: ${itemsText}. Valid 10 min. Do not share. — Invendis SL`
    : `AVDP PoD code: ${code}. Valid 10 min. Do not share. — Invendis SL`;

  const smsResult = await Promise.allSettled([sendSms(f.phone, message)]);
  const smsSent = smsResult[0].status === "fulfilled";

  if (smsSent) {
    req.log.info({ to: f.phone }, "OTP sent via EasySendSMS");
  } else {
    req.log.warn(
      { err: (smsResult[0] as PromiseRejectedResult).reason?.message },
      "EasySendSMS delivery failed"
    );
  }

  const deliveryFailed = !smsSent && !isDev;
  const channel = smsSent ? "sms" : "none";

  await dbInsert(Number(farmerId), hashCode(code), channel);

  res.json({
    sent:          true,
    smsSent,
    whatsappSent:  false,
    deliveryFailed,
    channel,
    maskedPhone:   maskPhone(f.phone),
    farmerName:    `${f.first_name} ${f.last_name}`,
    devCode:       isDev ? code : undefined,
  });
});

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

router.get("/api/pod/otp/status", requireAnyAuth, async (req, res) => {
  const { data } = await supa
    .from("system_settings")
    .select("value")
    .eq("key", "otp_enabled")
    .maybeSingle();
  const otpEnabled = data ? (data as any).value !== "false" && (data as any).value !== "0" : true;
  res.json({ otpEnabled });
});

router.post("/api/pod/otp/bypass", requireAnyAuth, async (req, res) => {
  const { farmerId, dispatchId, reason } = req.body as {
    farmerId: number;
    dispatchId?: number;
    reason?: string;
  };

  if (!farmerId) {
    res.status(400).json({ error: "farmerId is required" });
    return;
  }

  const bypassReason = reason?.trim() || "No SMS coverage";

  req.log.warn(
    { farmerId, dispatchId, reason: bypassReason, officerId: req.user?.userId },
    "OTP bypass recorded — flagged for supervisor review"
  );

  const description = `OTP bypassed for farmer #${farmerId}${dispatchId ? `, dispatch #${dispatchId}` : ""}. Reason: ${bypassReason}`;
  await logAudit(req, "OTP_BYPASS", "PoD", description, "farmer", Number(farmerId));

  res.json({ bypassed: true, reason: bypassReason, farmerId });
});

export default router;
