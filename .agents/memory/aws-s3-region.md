---
name: AWS S3 bucket region
description: invendimages bucket is in us-east-1, not eu-west-2; wrong region causes 301 on all uploads.
---

## Rule

The `invendimages` S3 bucket is in **us-east-1**. `AWS_REGION` must be `us-east-1`.

**Why:** The bucket was originally created in us-east-1 but `AWS_REGION` was set to `eu-west-2`. Presigned URLs generated for the wrong region cause S3 to return HTTP 301 (Moved Permanently) on every PUT. The field app's `uploadPhotoToS3` treats any non-2xx as a failure, so photos silently fail.

**How to apply:** If S3 uploads return 301, run:
```bash
curl -si "https://<bucket>.s3.amazonaws.com/" | grep x-amz-bucket-region
```
to get the real region without needing `s3:GetBucketLocation` IAM permission.

## IAM — invendis-edge-system

Requires both:
- `AmazonS3FullAccess` (managed policy, attached directly)
- `AmazonRekognitionFullAccess` or `InvendisRekognitionPolicy` (for CompareFaces / DetectLabels)

403 on PutObject = missing S3 policy. 301 on PutObject = wrong region.
