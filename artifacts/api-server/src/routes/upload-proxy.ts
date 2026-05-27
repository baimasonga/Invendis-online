import { Router } from "express";
import { PutObjectCommand } from "@aws-sdk/client-s3";
import { verifyUploadToken } from "../lib/auth.js";
import { s3, bucket } from "../lib/aws.js";

const router = Router();

// Log the domain config at startup so we can confirm proxy URLs are built correctly
const replitDomains = process.env.REPLIT_DOMAINS ?? "(not set)";
import("../lib/logger.js").then(({ logger }) =>
  logger.info({ replitDomains }, "Upload proxy route loaded")
).catch(() => {});

router.put("/api/upload-proxy", async (req, res) => {
  const { t: token } = req.query as { t?: string };

  if (!token) {
    res.status(401).json({ error: "Upload token required" });
    return;
  }

  let key: string;
  try {
    key = verifyUploadToken(token);
  } catch {
    res.status(401).json({ error: "Invalid or expired upload token" });
    return;
  }

  const body = req.body as Buffer | undefined;
  if (!body || !(body instanceof Buffer) || body.length === 0) {
    res.status(400).json({ error: "No photo data received" });
    return;
  }

  try {
    await s3.send(new PutObjectCommand({
      Bucket: bucket,
      Key: key,
      Body: body,
      ContentType: "image/jpeg",
    }));
    req.log.info({ key, bytes: body.length }, "Photo uploaded to S3 via proxy");
    res.status(200).json({ success: true, key });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    req.log.error({ err: msg, key }, "S3 proxy upload failed");
    res.status(500).json({ error: `S3 upload failed: ${msg}` });
  }
});

export default router;
