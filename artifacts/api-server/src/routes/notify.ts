import { Router } from "express";
import { createHash } from "crypto";
import QRCode from "qrcode";
import { requireAnyAuth } from "../lib/auth.js";
import { supa } from "../lib/supabase.js";
import { s3, bucket } from "../lib/aws.js";
import { logger } from "../lib/logger.js";
import { PutObjectCommand, GetObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";

const router = Router();

function normalisePhone(raw: string): string {
  let p = raw.replace(/[\s\-().+]/g, "");
  if (p.startsWith("00")) p = p.slice(2);
  if (p.startsWith("0") && p.length <= 9) p = "232" + p.slice(1);
  return p;
}

function hashCode(code: string): string {
  return createHash("sha256").update(code).digest("hex");
}

async function sendSms(to: string, text: string): Promise<void> {
  const username = process.env["EASYSENDSMS_USERNAME"];
  const password = process.env["EASYSENDSMS_PASSWORD"];
  const sender = (process.env["EASYSENDSMS_SENDER"] ?? "AgriPoD").slice(0, 11);
  if (!username || !password) throw new Error("EasySendSMS credentials not configured");
  const params = new URLSearchParams({ username, password, from: sender, to: normalisePhone(to), text, type: "0" });
  const resp = await fetch(`https://api.easysendsms.app/bulksms?${params}`, { signal: AbortSignal.timeout(15_000) });
  const body = (await resp.text()).trim();
  if (!body.toUpperCase().startsWith("OK")) throw new Error(`SMS error: ${body}`);
}

async function sendWhatsAppImage(to: string, mediaUrl: string, caption: string): Promise<void> {
  const username = process.env["EASYSENDSMS_USERNAME"];
  const password = process.env["EASYSENDSMS_PASSWORD"];
  const sender = (process.env["EASYSENDSMS_SENDER"] ?? "AgriPoD").slice(0, 11);
  if (!username || !password) throw new Error("EasySendSMS credentials not configured");
  const params = new URLSearchParams({ username, password, to: normalisePhone(to), from: sender, type: "image", media: mediaUrl, text: caption });
  const resp = await fetch(`https://api.easysendsms.app/whatsapp?${params}`, { signal: AbortSignal.timeout(15_000) });
  const body = (await resp.text()).trim();
  if (!body.toUpperCase().startsWith("OK")) throw new Error(`WhatsApp error: ${body}`);
}

router.post("/api/dispatches/:id/notify-farmers", requireAnyAuth, async (req, res) => {
  const dispatchId = Number(req.params["id"]);
  if (!dispatchId) { res.status(400).json({ error: "Invalid dispatch ID" }); return; }

  const { data: dispatch, error: dispErr } = await supa
    .from("dispatches")
    .select("id, campaign_id, manifest_code")
    .eq("id", dispatchId)
    .single();

  if (dispErr || !dispatch) {
    res.status(404).json({ error: "Dispatch not found" });
    return;
  }

  const d = dispatch as any;

  const { data: campaign } = await supa
    .from("campaigns")
    .select("name")
    .eq("id", d.campaign_id)
    .single();

  const campaignName = (campaign as any)?.name ?? "Distribution";

  const { data: allocations, error: allocErr } = await supa
    .from("allocations")
    .select("farmer_id")
    .eq("campaign_id", d.campaign_id)
    .not("status", "eq", "Rejected");

  if (allocErr) {
    res.status(500).json({ error: allocErr.message });
    return;
  }

  if (!allocations?.length) {
    res.json({ total: 0, notified: 0, noPhone: 0, failed: 0, campaignName, message: "No allocations found for this campaign" });
    return;
  }

  const farmerIds = (allocations as any[]).map((a: any) => a.farmer_id).filter(Boolean);

  const { data: farmers, error: farmerErr } = await supa
    .from("farmers")
    .select("id, first_name, last_name, phone, barcode_token")
    .in("id", farmerIds);

  if (farmerErr || !farmers?.length) {
    res.json({ total: 0, notified: 0, noPhone: 0, failed: 0, campaignName, message: "No farmers found" });
    return;
  }

  let notified = 0, noPhone = 0, failed = 0;
  const EXPIRY_MS = 7 * 24 * 60 * 60 * 1000;

  for (const farmer of farmers as any[]) {
    if (!farmer.phone) {
      noPhone++;
      continue;
    }

    try {
      const code = Math.floor(100_000 + Math.random() * 900_000).toString();
      const expiresAt = new Date(Date.now() + EXPIRY_MS).toISOString();

      await supa.from("otp_codes").delete().eq("farmer_id", farmer.id);
      await supa.from("otp_codes").insert({
        farmer_id: farmer.id,
        code_hash: hashCode(code),
        channel: "campaign",
        expires_at: expiresAt,
        attempts: 0,
      });

      const qrContent = farmer.barcode_token ?? String(farmer.id);
      const qrBuffer = await QRCode.toBuffer(qrContent, { type: "png", width: 320, margin: 2 });

      const s3Key = `farmers/${farmer.id}/qr/dispatch-${dispatchId}.png`;
      await s3.send(new PutObjectCommand({ Bucket: bucket, Key: s3Key, Body: qrBuffer, ContentType: "image/png" }));

      const qrUrl = await getSignedUrl(s3, new GetObjectCommand({ Bucket: bucket, Key: s3Key }), { expiresIn: 600 });

      const farmerName = [farmer.first_name, farmer.last_name].filter(Boolean).join(" ") || "Farmer";
      const smsText = `AVDP PoD: Your delivery code for ${campaignName} is: ${code}. Show this code to the field officer to collect your inputs.`;
      const waCaption = `AVDP PoD — ${farmerName}\n\nYour QR card for ${campaignName} is attached.\nDelivery code: *${code}*\n\nShow BOTH to the field officer to receive your agricultural inputs.`;

      const [waResult, smsResult] = await Promise.allSettled([
        sendWhatsAppImage(farmer.phone, qrUrl, waCaption),
        sendSms(farmer.phone, smsText),
      ]);

      const waSent  = waResult.status === "fulfilled";
      const smsSent = smsResult.status === "fulfilled";

      if (!waSent) logger.warn({ err: (waResult as PromiseRejectedResult).reason?.message, farmerId: farmer.id }, "WhatsApp send failed");
      if (!smsSent) logger.warn({ err: (smsResult as PromiseRejectedResult).reason?.message, farmerId: farmer.id }, "SMS send failed");

      if (waSent || smsSent) {
        notified++;
      } else {
        failed++;
      }
    } catch (err: any) {
      failed++;
      logger.warn({ err: err.message, farmerId: farmer.id }, "notify-farmer failed");
    }
  }

  res.json({ total: (farmers as any[]).length, notified, noPhone, failed, campaignName, dispatchId });
});

export default router;
