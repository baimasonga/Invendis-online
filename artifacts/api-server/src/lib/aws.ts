import { S3Client, PutObjectCommand, GetObjectCommand } from "@aws-sdk/client-s3";
import { RekognitionClient, CompareFacesCommand } from "@aws-sdk/client-rekognition";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";

const region = (process.env.AWS_REGION ?? "eu-west-2").trim();
const bucket = (process.env.AWS_S3_BUCKET ?? "invendimages").trim();
const accessKeyId = (process.env.AWS_ACCESS_KEY_ID ?? "").trim();
const secretAccessKey = (process.env.AWS_SECRET_ACCESS_KEY ?? "").trim();

const credentials = { accessKeyId, secretAccessKey };

export const s3 = new S3Client({ region, credentials });
export const rekognition = new RekognitionClient({ region, credentials });

export { bucket };

export async function getPresignedUploadUrl(key: string, contentType: string): Promise<string> {
  const cmd = new PutObjectCommand({ Bucket: bucket, Key: key, ContentType: contentType });
  return getSignedUrl(s3, cmd, { expiresIn: 300 });
}

export async function getPresignedViewUrl(key: string): Promise<string> {
  const cmd = new GetObjectCommand({ Bucket: bucket, Key: key });
  return getSignedUrl(s3, cmd, { expiresIn: 3600 });
}

export interface FaceCompareResult {
  matched: boolean;
  similarity: number | null;
  reason: "matched" | "no_match" | "no_face_in_source" | "no_face_in_target" | "no_reference_photo" | "error";
  detail?: string;
}

export async function compareFaces(
  referenceKey: string,
  targetKey: string
): Promise<FaceCompareResult> {
  try {
    const cmd = new CompareFacesCommand({
      SourceImage: { S3Object: { Bucket: bucket, Name: referenceKey } },
      TargetImage: { S3Object: { Bucket: bucket, Name: targetKey } },
      SimilarityThreshold: 0,
    });
    const result = await rekognition.send(cmd);
    const matches = result.FaceMatches ?? [];
    const unmatched = result.UnmatchedFaces ?? [];

    if (matches.length === 0 && unmatched.length === 0) {
      return { matched: false, similarity: null, reason: "no_face_in_target" };
    }

    if (matches.length > 0) {
      const best = matches.sort((a, b) => (b.Similarity ?? 0) - (a.Similarity ?? 0))[0];
      const similarity = best.Similarity ?? 0;
      return {
        matched: similarity >= 80,
        similarity: Math.round(similarity * 10) / 10,
        reason: similarity >= 80 ? "matched" : "no_match",
      };
    }

    return { matched: false, similarity: null, reason: "no_match" };
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    if (msg.includes("InvalidParameterException") && msg.includes("source")) {
      return { matched: false, similarity: null, reason: "no_face_in_source", detail: msg };
    }
    if (msg.includes("InvalidParameterException") && msg.includes("target")) {
      return { matched: false, similarity: null, reason: "no_face_in_target", detail: msg };
    }
    return { matched: false, similarity: null, reason: "error", detail: msg };
  }
}
