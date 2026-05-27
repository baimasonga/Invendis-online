import { S3Client, PutObjectCommand, GetObjectCommand } from "@aws-sdk/client-s3";
import {
  RekognitionClient,
  CompareFacesCommand,
  DetectLabelsCommand,
  DetectFacesCommand,
} from "@aws-sdk/client-rekognition";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";

// invendimages S3 bucket is in us-east-1. AWS_REGION env var is eu-west-2 (wrong).
// Hardcode us-east-1 so server-side PutObjectCommand reaches the correct endpoint.
const S3_REGION = "us-east-1";
const bucket = (process.env.AWS_S3_BUCKET ?? "invendimages").trim();
const accessKeyId = (process.env.AWS_ACCESS_KEY_ID ?? "").trim();
const secretAccessKey = (process.env.AWS_SECRET_ACCESS_KEY ?? "").trim();

const credentials = { accessKeyId, secretAccessKey };

export const s3 = new S3Client({ region: S3_REGION, credentials });
export const rekognition = new RekognitionClient({ region: S3_REGION, credentials });

export { bucket };

export async function getPresignedUploadUrl(key: string, _contentType?: string): Promise<string> {
  // Do NOT include ContentType in the command — if it's a signed header,
  // React Native's blob body overrides the explicit Content-Type header,
  // causing a SignatureDoesNotMatch error on the S3 PUT.
  const cmd = new PutObjectCommand({ Bucket: bucket, Key: key });
  return getSignedUrl(s3, cmd, { expiresIn: 600 });
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

// Agricultural input labels Rekognition commonly detects
const AGRI_LABELS = new Set([
  "Bag", "Sack", "Gunny Sack", "Burlap", "Fertilizer", "Seed", "Seeds",
  "Grain", "Grains", "Rice", "Maize", "Corn", "Wheat", "Crops", "Crop",
  "Plant", "Plants", "Agriculture", "Farm", "Farming", "Harvest",
  "Container", "Bucket", "Box", "Boxes", "Package", "Packaging", "Bottle",
  "Jug", "Canister", "Barrel", "Crate", "Pallet", "Silo", "Warehouse",
  "Tool", "Shovel", "Hoe", "Equipment", "Machine", "Machinery",
  "Powder", "Chemical", "Pesticide", "Herbicide",
]);

export interface LabelAnalysisResult {
  labels: { name: string; confidence: number; isAgri: boolean }[];
  hasAgriContent: boolean;
  topAgriLabels: string[];
  confidence: number | null;
}

export async function detectLabels(s3Key: string): Promise<LabelAnalysisResult> {
  const cmd = new DetectLabelsCommand({
    Image: { S3Object: { Bucket: bucket, Name: s3Key } },
    MaxLabels: 30,
    MinConfidence: 50,
  });
  const result = await rekognition.send(cmd);
  const labels = (result.Labels ?? []).map(l => ({
    name: l.Name ?? "",
    confidence: Math.round((l.Confidence ?? 0) * 10) / 10,
    isAgri: AGRI_LABELS.has(l.Name ?? ""),
  }));
  const agriLabels = labels.filter(l => l.isAgri);
  return {
    labels,
    hasAgriContent: agriLabels.length > 0,
    topAgriLabels: agriLabels.slice(0, 5).map(l => l.name),
    confidence: agriLabels.length > 0 ? Math.max(...agriLabels.map(l => l.confidence)) : null,
  };
}

export interface FaceAttributeResult {
  ageRangeLow: number | null;
  ageRangeHigh: number | null;
  gender: string | null;
  genderConfidence: number | null;
  smile: boolean | null;
  smileConfidence: number | null;
  eyesOpen: boolean | null;
  primaryEmotion: string | null;
  primaryEmotionConfidence: number | null;
  faceQuality: number | null;
  brightness: number | null;
  sharpness: number | null;
  faceCount: number;
}

export async function detectFaces(s3Key: string): Promise<FaceAttributeResult> {
  const cmd = new DetectFacesCommand({
    Image: { S3Object: { Bucket: bucket, Name: s3Key } },
    Attributes: ["ALL"],
  });
  const result = await rekognition.send(cmd);
  const faces = result.FaceDetails ?? [];
  const faceCount = faces.length;
  if (faceCount === 0) {
    return {
      ageRangeLow: null, ageRangeHigh: null, gender: null, genderConfidence: null,
      smile: null, smileConfidence: null, eyesOpen: null,
      primaryEmotion: null, primaryEmotionConfidence: null,
      faceQuality: null, brightness: null, sharpness: null, faceCount: 0,
    };
  }
  // Use the face with highest confidence
  const face = faces.sort((a, b) => (b.Confidence ?? 0) - (a.Confidence ?? 0))[0];
  const emotions = (face.Emotions ?? []).sort((a, b) => (b.Confidence ?? 0) - (a.Confidence ?? 0));
  const brightness = face.Quality?.Brightness ?? null;
  const sharpness  = face.Quality?.Sharpness ?? null;
  const faceQuality = (brightness != null && sharpness != null)
    ? Math.round((brightness + sharpness) / 2 * 10) / 10
    : null;
  return {
    ageRangeLow:               face.AgeRange?.Low ?? null,
    ageRangeHigh:              face.AgeRange?.High ?? null,
    gender:                    face.Gender?.Value ?? null,
    genderConfidence:          face.Gender?.Confidence != null ? Math.round(face.Gender.Confidence * 10) / 10 : null,
    smile:                     face.Smile?.Value ?? null,
    smileConfidence:           face.Smile?.Confidence != null ? Math.round(face.Smile.Confidence * 10) / 10 : null,
    eyesOpen:                  face.EyesOpen?.Value ?? null,
    primaryEmotion:            emotions[0]?.Type ?? null,
    primaryEmotionConfidence:  emotions[0]?.Confidence != null ? Math.round(emotions[0].Confidence * 10) / 10 : null,
    faceQuality,
    brightness:                brightness != null ? Math.round(brightness * 10) / 10 : null,
    sharpness:                 sharpness  != null ? Math.round(sharpness  * 10) / 10 : null,
    faceCount,
  };
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
