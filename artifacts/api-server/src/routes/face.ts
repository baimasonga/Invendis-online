import { Router } from "express";
import { requireAnyAuth, generateProxyUploadUrl } from "../lib/auth.js";
import { supa } from "../lib/supabase.js";
import { getPresignedViewUrl, compareFaces, detectLabels, detectFaces, bucket } from "../lib/aws.js";
import { logAudit } from "../lib/audit.js";

const router = Router();

router.post("/api/face/upload-url", requireAnyAuth, async (req, res) => {
  const { farmerId, purpose } = req.body as { farmerId?: number; purpose?: string };

  const safeP = purpose === "reference" ? "reference" : purpose === "identify" ? "identify" : "delivery";
  const key = farmerId
    ? `farmers/${farmerId}/${safeP}/${Date.now()}.jpg`
    : `identify/${Date.now()}.jpg`;
  try {
    const url = generateProxyUploadUrl(key, req);
    res.json({ uploadUrl: url, key, bucket });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    res.status(500).json({ error: msg });
  }
});

router.get("/api/face/view-url", requireAnyAuth, async (req, res) => {
  const { key } = req.query as { key?: string };
  if (!key) { res.status(400).json({ error: "key is required" }); return; }
  try {
    const url = await getPresignedViewUrl(key);
    res.json({ url });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    res.status(500).json({ error: msg });
  }
});

router.post("/api/face/compare", requireAnyAuth, async (req, res) => {
  const { farmerId, deliveryKey } = req.body as { farmerId?: number; deliveryKey?: string };
  if (!farmerId || !deliveryKey) {
    res.status(400).json({ error: "farmerId and deliveryKey are required" });
    return;
  }

  const { data: rows } = await supa.from("farmers").select("photo_url").eq("id", farmerId).limit(1);
  const referenceKey: string | null = (rows?.[0] as any)?.photo_url ?? null;

  if (!referenceKey) {
    res.json({ matched: false, similarity: null, reason: "no_reference_photo", faceStatus: "NoReference" });
    return;
  }

  try {
    const result = await compareFaces(referenceKey, deliveryKey);
    const faceStatus = result.matched ? "Verified" : result.reason === "no_face_in_target" ? "NoFace" : result.reason === "no_reference_photo" ? "NoReference" : "Failed";
    await logAudit(req, "FACE_COMPARE", "PoD", `Face compare farmer ${farmerId}: ${faceStatus} (${result.similarity ?? "n/a"}%)`, "farmer", farmerId);
    res.json({ ...result, faceStatus });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    res.status(500).json({ error: msg });
  }
});

router.post("/api/face/analyse-labels", requireAnyAuth, async (req, res) => {
  const { s3Key } = req.body as { s3Key?: string };
  if (!s3Key) { res.status(400).json({ error: "s3Key is required" }); return; }
  try {
    const result = await detectLabels(s3Key);
    await logAudit(req, "ANALYSE", "PoD", `Label analysis on photo: ${s3Key} — agri=${result.hasAgriContent}`, "pod", undefined);
    res.json(result);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    res.status(500).json({ error: msg });
  }
});

router.post("/api/face/analyse-farmer", requireAnyAuth, async (req, res) => {
  const { s3Key, farmerId } = req.body as { s3Key?: string; farmerId?: number };
  if (!s3Key) { res.status(400).json({ error: "s3Key is required" }); return; }
  try {
    const result = await detectFaces(s3Key);
    await logAudit(req, "ANALYSE", "Farmers", `Face attribute analysis for farmer ${farmerId ?? "unknown"}: ${result.faceCount} face(s) detected`, "farmer", farmerId ?? undefined);
    res.json(result);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    res.status(500).json({ error: msg });
  }
});

router.post("/api/face/find-farmer", requireAnyAuth, async (req, res) => {
  const { photoKey } = req.body as { photoKey?: string };
  if (!photoKey) { res.status(400).json({ error: "photoKey is required" }); return; }

  const { data: farmers } = await supa
    .from("farmers")
    .select("id, first_name, last_name, farmer_code, gender, age_group, beneficiary_type, group_size, farmer_group, photo_url")
    .not("photo_url", "is", null)
    .limit(100);

  if (!farmers || farmers.length === 0) {
    res.json({ matched: false, farmer: null, similarity: null, reason: "no_reference_photos" });
    return;
  }

  const results = await Promise.allSettled(
    (farmers as any[]).map(async (f) => ({
      farmer: f,
      compare: await compareFaces(f.photo_url, photoKey),
    }))
  );

  type Resolved = { farmer: any; compare: { similarity: number | null } };
  const matches: Resolved[] = [];
  for (const r of results) {
    if (r.status === "fulfilled" && r.value.compare.similarity != null && r.value.compare.similarity >= 70) {
      matches.push(r.value);
    }
  }
  matches.sort((a, b) => (b.compare.similarity ?? 0) - (a.compare.similarity ?? 0));

  if (matches.length === 0) {
    res.json({ matched: false, farmer: null, similarity: null, reason: "no_match" });
    return;
  }

  const best = matches[0];
  const f = best.farmer;
  const similarity = best.compare.similarity;

  await logAudit(req, "FACE_IDENTIFY", "Farmers",
    `Face identification matched farmer ${f.id} at ${similarity}% similarity`, "farmer", f.id);

  res.json({
    matched: true,
    similarity,
    farmer: {
      id: f.id,
      firstName: f.first_name,
      lastName: f.last_name,
      farmerCode: f.farmer_code,
      gender: f.gender,
      ageGroup: f.age_group,
      beneficiaryType: f.beneficiary_type,
      groupSize: f.group_size,
      farmerGroup: f.farmer_group,
    },
  });
});

router.post("/api/face/save-reference", requireAnyAuth, async (req, res) => {
  const { farmerId, key } = req.body as { farmerId?: number; key?: string };
  if (!farmerId || !key) { res.status(400).json({ error: "farmerId and key are required" }); return; }
  const { data, error } = await supa.from("farmers").update({ photo_url: key }).eq("id", farmerId).select().single();
  if (error) { res.status(500).json({ error: error.message }); return; }
  await logAudit(req, "UPDATE", "Farmers", `Saved reference photo for farmer ${farmerId}`, "farmer", farmerId);
  res.json({ success: true, photoUrl: key });
});

export default router;
