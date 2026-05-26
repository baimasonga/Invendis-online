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

async function sendViaAt(to: string, text: string): Promise<void> {
  const apiKey   = process.env.AT_API_KEY;
  const username = process.env.AT_USERNAME;
  if (!apiKey || !username) throw new Error("AT credentials not configured (AT_API_KEY / AT_USERNAME)");

  const isSandbox = process.env.AT_SANDBOX === "true";
  const endpoint  = isSandbox
    ? "https://api.sandbox.africastalking.com/version1/messaging"
    : "https://api.africastalking.com/version1/messaging";
  const atUsername = isSandbox ? "sandbox" : username;

  const e164 = "+" + normalisePhone(to);
  const body = new URLSearchParams({ username: atUsername, to: e164, message: text });
  if (!isSandbox && process.env.AT_SENDER_ID) body.set("from", process.env.AT_SENDER_ID);

  const resp = await fetch(endpoint, {
    method:  "POST",
    headers: {
      "apiKey":       apiKey,
      "Content-Type": "application/x-www-form-urlencoded",
      "Accept":       "application/json",
    },
    body,
  });

  const json = await resp.json() as any;
  const recipient = json?.SMSMessageData?.Recipients?.[0];
  if (!resp.ok || (recipient && recipient.status !== "Success")) {
    throw new Error(`AT${isSandbox ? " [sandbox]" : ""} error: ${recipient?.status ?? json?.SMSMessageData?.Message ?? JSON.stringify(json)}`);
  }
}

async function sendViaTwilio(to: string, text: string): Promise<void> {
  const accountSid = process.env.TWILIO_ACCOUNT_SID;
  const authToken  = process.env.TWILIO_AUTH_TOKEN;
  const from       = process.env.TWILIO_PHONE_NUMBER;
  if (!accountSid || !authToken || !from) throw new Error("Twilio credentials not configured");

  const e164 = "+" + normalisePhone(to);
  const body = new URLSearchParams({ To: e164, From: from, Body: text });
  const creds = Buffer.from(`${accountSid}:${authToken}`).toString("base64");

  const resp = await fetch(
    `https://api.twilio.com/2010-04-01/Accounts/${accountSid}/Messages.json`,
    {
      method:  "POST",
      headers: { "Authorization": `Basic ${creds}`, "Content-Type": "application/x-www-form-urlencoded" },
      body,
    }
  );
  const json = await resp.json() as { sid?: string; status?: string; message?: string; code?: number };
  if (!resp.ok) throw new Error(`Twilio error ${resp.status}: ${json.message ?? JSON.stringify(json)}`);
}

async function sendSms(to: string, text: string): Promise<{ provider: string }> {
  try {
    await sendViaAt(to, text);
    return { provider: "africastalking" };
  } catch (atErr: any) {
    try {
      await sendViaTwilio(to, text);
      return { provider: "twilio-fallback" };
    } catch (twilioErr: any) {
      throw new Error(`AT failed (${atErr.message}); Twilio fallback also failed (${twilioErr.message})`);
    }
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
  const smsProvider = smsSent ? (smsResult[0] as PromiseFulfilledResult<{ provider: string }>).value.provider : null;

  if (smsSent) {
    req.log.info({ to: f.phone, provider: smsProvider }, "OTP SMS sent");
  } else {
    req.log.warn(
      { err: (smsResult[0] as PromiseRejectedResult).reason?.message },
      "OTP SMS delivery failed (AT + Twilio both failed)"
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

// ── POST /api/pod/otp/bulk-generate ──────────────────────────────────────────
// Pre-generate OTP codes for field trials (no SMS sent).
// Returns plain codes so admins can print/distribute them.
router.post("/api/pod/otp/bulk-generate", requireAnyAuth, async (req, res) => {
  const { campaignId, expiryHours = 24 } = req.body as {
    campaignId?: number;
    expiryHours?: number;
  };

  const clampedHours = Math.min(Math.max(Number(expiryHours) || 24, 1), 72);
  const expiresAt = new Date(Date.now() + clampedHours * 60 * 60 * 1000).toISOString();

  // Fetch target farmers
  let farmerIds: number[] = [];

  if (campaignId) {
    const { data: allocs } = await supa
      .from("allocations")
      .select("farmer_id")
      .eq("campaign_id", Number(campaignId));
    farmerIds = (allocs ?? []).map((a: any) => a.farmer_id).filter(Boolean);
  }

  const query = supa
    .from("farmers")
    .select("id, first_name, last_name, farmer_code, phone")
    .in("status", ["approved", "Approved"])
    .order("first_name");

  const { data: farmers, error: farmersErr } = farmerIds.length > 0
    ? await query.in("id", farmerIds)
    : await query.limit(500);

  if (farmersErr) {
    res.status(500).json({ error: farmersErr.message });
    return;
  }

  const rows: { farmerId: number; farmerName: string; farmerCode: string; phone: string | null; code: string }[] = [];

  for (const farmer of farmers ?? []) {
    const f = farmer as any;
    const code = Math.floor(100000 + Math.random() * 900000).toString();
    const codeHash = createHash("sha256").update(code).digest("hex");

    // Replace any existing OTP for this farmer
    await supa.from("otp_codes").delete().eq("farmer_id", f.id);
    await supa.from("otp_codes").insert({
      farmer_id: f.id,
      code_hash:  codeHash,
      channel:    "pre-generated",
      expires_at: expiresAt,
      attempts:   0,
    });

    rows.push({
      farmerId:   f.id,
      farmerName: `${f.first_name} ${f.last_name}`,
      farmerCode: f.farmer_code ?? "",
      phone:      f.phone ?? null,
      code,
    });
  }

  req.log.info({ count: rows.length, campaignId, expiryHours: clampedHours }, "Bulk OTP pre-generated");

  res.json({
    count:       rows.length,
    expiresAt,
    expiryHours: clampedHours,
    rows,
  });
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
