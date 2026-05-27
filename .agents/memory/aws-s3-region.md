---
name: AWS S3 bucket region
description: invendimages bucket is in us-east-1; AWS_REGION env var is eu-west-2 (wrong) — hardcoded us-east-1 in aws.ts.
---

## Rule

The `invendimages` S3 bucket is in **us-east-1**. The `AWS_REGION` env var is **eu-west-2** (wrong) and must NOT be used for S3 or Rekognition.

**Fix already applied:** `aws.ts` hardcodes `const S3_REGION = "us-east-1"` and uses it for both `S3Client` and `RekognitionClient`. Do NOT revert to `process.env.AWS_REGION` — it is wrong.

**Why:** Presigned URLs with the wrong region return HTTP 301 (Moved Permanently) — silently masked because redirects look like success. Server-side `PutObjectCommand` (upload proxy) fails hard with "bucket must be addressed using the specified endpoint" — this is how the real region bug was finally exposed.

**How to apply:** If S3 region ever needs to change, update `S3_REGION` in `artifacts/api-server/src/lib/aws.ts` directly. Do not rely on `AWS_REGION` env var.

## IAM — invendis-edge-system

Requires both:
- `AmazonS3FullAccess` (managed policy, attached directly)
- `AmazonRekognitionFullAccess` (for CompareFaces / DetectLabels)

403 on PutObject = missing S3 policy. 301 on PutObject = wrong region.

## Upload architecture (as of current fix)

Field app does NOT upload directly to S3. Flow:
1. Field app: `POST /api/pod/photo-upload-url` → gets `https://<domain>/api/upload-proxy?key=...&t=<jwt>`
2. Field app: `PUT /api/upload-proxy` → API server receives raw binary body
3. API server: `PutObjectCommand` to S3 (us-east-1) → success
4. Web portal: `GET /api/face/view-url?key=...` → presigned S3 GET URL → `<img>`

This eliminates all React Native direct-S3-PUT issues (blob Content-Type override, CORS).
