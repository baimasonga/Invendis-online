import { Router } from "express";
import { createHash, randomBytes } from "crypto";
import { supa } from "../lib/supabase.js";
import { requireAnyAuth, requireRoleIfJwt } from "../lib/auth.js";
import { logAudit } from "../lib/audit.js";
import { validateBody, OtpSendSchema, OtpVerifySchema } from "../lib/validate.js";
import { canReadDispatch } from "../lib/dispatch-auth.js";

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
async function mintProof(kind: "otp", farmerId: number, dispatchId: number, status: string): Promise<string> {
  const token = randomBytes(32).toString("base64url");
  const tokenHash = hashCode(token);
  const { error } = await supa.from("pod_verification_proofs").insert({
    token_hash: tokenHash, kind, farmer_id: farmerId, dispatch_id: dispatchId, status,
    // One-use and resource-bound, but long enough for an offline queue replay.
    expires_at: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(),
  });
  if (error) throw new Error(`Unable to issue verification proof: ${error.message}`);
  return token;
}
async function canUseFarmerOnDispatch(
  req: import("express").Request,
  dispatchId: number,
  farmerId: number,
): Promise<boolean> {
  const { data } = await supa.from("dispatches").select("field_officer_id,campaign_id").eq("id", dispatchId).maybeSingle();
  if (!data || !(await canReadDispatch(req, data as any))) return false;
  const { data: allocation } = await supa.from("allocations")
    .select("id")
    .eq("campaign_id", (data as any).campaign_id)
    .eq("farmer_id", farmerId)
    .in("status", ["Approved", "Pending"])
    .limit(1)
    .maybeSingle();
  return !!allocation;
}

async function sendViaEasySendSms(to: string, text: string): Promise<void> {
  const username = process.env.EASYSENDSMS_USERNAME;
  const password = process.env.EASYSENDSMS_PASSWORD;
  const sender   = (process.env.EASYSENDSMS_SENDER ?? "AVDP").slice(0, 11);
  if (!username || !password) throw new Error("EasySendSMS credentials not configured (EASYSENDSMS_USERNAME / EASYSENDSMS_PASSWORD)");

  const params = new URLSearchParams({
    username,
    password,
    from: sender,
    to:   normalisePhone(to),
    text,
    type: "0",
  });

  const resp = await fetch(`https://api.easysendsms.app/bulksms?${params}`, {
    signal: AbortSignal.timeout(15_000),
  });
  const body = (await resp.text()).trim();
  if (!body.toUpperCase().startsWith("OK")) throw new Error(`EasySendSMS error: ${body}`);
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
    await sendViaEasySendSms(to, text);
    return { provider: "easysendsms" };
  } catch (primaryErr: any) {
    try {
      await sendViaTwilio(to, text);
      return { provider: "twilio-fallback" };
    } catch (twilioErr: any) {
      throw new Error(`EasySendSMS failed (${primaryErr.message}); Twilio fallback also failed (${twilioErr.message})`);
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
  const expiresAt = new Date(Date.now() + 74 * 60 * 60 * 1000).toISOString();
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
  const { farmerId, dispatchId: rawDispatchId } = req.body as {
    farmerId: number;
    dispatchId: number;
  };
  if (!(await canUseFarmerOnDispatch(req, rawDispatchId, farmerId))) {
    res.status(403).json({ error: "Forbidden", message: "You may not send OTP for this farmer and dispatch" });
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

  // Resolve campaignId (from body or via dispatch lookup)
  const { data: disp } = await supa
    .from("dispatches")
    .select("campaign_id")
    .eq("id", rawDispatchId)
    .single();
  const campaignId: number | null = (disp as any)?.campaign_id ?? null;

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
    ? `AVDP-PoD ${code} is your delivery code for ${itemsText}. Valid for 74 hours. Do share. - Agriculture Value Chain Development Project (AVDP)`
    : `AVDP-PoD ${code} is your delivery code. Valid for 74 hours. Do share. - Agriculture Value Chain Development Project (AVDP)`;

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
  const { farmerId, code, dispatchId } = req.body as { farmerId: number; code: string; dispatchId: number };
  if (!(await canUseFarmerOnDispatch(req, Number(dispatchId), Number(farmerId)))) {
    res.status(403).json({ error: "Forbidden", message: "You may not verify OTP for this dispatch" });
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
  const verificationToken = await mintProof("otp", Number(farmerId), Number(dispatchId), "Verified");
  res.json({ verified: true, verificationToken });
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
router.post("/api/pod/otp/bulk-generate", requireAnyAuth, requireRoleIfJwt("Admin", "ProjectManager", "DistrictCoordinator", "WarehouseManager"), async (req, res) => {
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

router.post("/api/pod/otp/bypass", requireAnyAuth, requireRoleIfJwt("FieldOfficer", "Admin", "ProjectManager", "DistrictCoordinator", "WarehouseManager"), async (req, res) => {
  const { farmerId, dispatchId, reason } = req.body as {
    farmerId: number;
    dispatchId?: number;
    reason?: string;
  };

  if (!farmerId) {
    res.status(400).json({ error: "farmerId is required" });
    return;
  }
  if (!dispatchId) {
    res.status(400).json({ error: "dispatchId is required for OTP bypass" });
    return;
  }
  if (!(await canUseFarmerOnDispatch(req, Number(dispatchId), Number(farmerId)))) {
    res.status(403).json({ error: "Forbidden", message: "You may not bypass OTP for this dispatch" });
    return;
  }

  const bypassReason = reason?.trim() || "No SMS coverage";

  req.log.warn(
    { farmerId, dispatchId, reason: bypassReason, officerId: req.user?.userId },
    "OTP bypass recorded — flagged for supervisor review"
  );

  const description = `OTP bypassed for farmer #${farmerId}${dispatchId ? `, dispatch #${dispatchId}` : ""}. Reason: ${bypassReason}`;
  await logAudit(req, "OTP_BYPASS", "PoD", description, "farmer", Number(farmerId));

  try {
    const verificationToken = await mintProof("otp", Number(farmerId), Number(dispatchId), "Bypassed");
    res.json({ bypassed: true, reason: bypassReason, farmerId, verificationToken });
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : "Unable to record OTP bypass proof" });
  }
});

export default router;
