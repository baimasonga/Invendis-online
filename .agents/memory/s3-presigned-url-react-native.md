---
name: S3 presigned URL — React Native blob upload
description: Why ContentType must NOT be signed in presigned URLs when the client is React Native.
---

## Rule
Never include `ContentType` in the `PutObjectCommand` when generating presigned S3 upload URLs for React Native clients.

**Why:** React Native's `fetch` with a `blob` body ignores the explicit `Content-Type` header and sends the blob's own MIME type instead. If `ContentType` is a signed header in the presigned URL (i.e. it was set on `PutObjectCommand`), S3 gets a `SignatureDoesNotMatch` → 403 because the actual header doesn't match what was signed.

**How to apply:** In `getPresignedUploadUrl`, use:
```ts
const cmd = new PutObjectCommand({ Bucket: bucket, Key: key }); // no ContentType
```
Not:
```ts
const cmd = new PutObjectCommand({ Bucket: bucket, Key: key, ContentType: contentType }); // WRONG for RN
```

## Related issues also fixed
- S3 bucket `invendimages` had **no CORS policy** — must configure PUT/GET/HEAD CORS or direct uploads from apps are rejected.
- Default region fallback in `aws.ts` was `eu-west-2`; bucket is in `us-east-1`. Fixed fallback to `us-east-1`.
