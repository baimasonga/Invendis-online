import { Router } from "express";
import { requireAnyAuth } from "../lib/auth.js";
import { supa } from "../lib/supabase.js";
import { getPresignedUploadUrl, getPresignedViewUrl, compareFaces, bucket } from "../lib/aws.js";
import { logAudit } from "../lib/audit.js";

const router = Router();

router.post("/api/face/upload-url", requireAnyAuth, async (req, res) => {
  const { farmerId, purpose } = req.body as { farmerId?: number; purpose?: string };
  if (!farmerId) { res.status(400).json({ error: "farmerId is required" }); return; }

  const safeP = purpose === "reference" ? "reference" : "delivery";
  const key = `farmers/${farmerId}/${safeP}/${Date.now()}.jpg`;
  try {
    const url = await getPresignedUploadUrl(key, "image/jpeg");
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

router.post("/api/face/save-reference", requireAnyAuth, async (req, res) => {
  const { farmerId, key } = req.body as { farmerId?: number; key?: string };
  if (!farmerId || !key) { res.status(400).json({ error: "farmerId and key are required" }); return; }
  const { data, error } = await supa.from("farmers").update({ photo_url: key }).eq("id", farmerId).select().single();
  if (error) { res.status(500).json({ error: error.message }); return; }
  await logAudit(req, "UPDATE", "Farmers", `Saved reference photo for farmer ${farmerId}`, "farmer", farmerId);
  res.json({ success: true, photoUrl: key });
});

export default router;
