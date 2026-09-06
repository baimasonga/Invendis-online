import { Router } from "express";
import { requireAnyAuth } from "../lib/auth.js";

const router = Router();

router.post(["/api/pod", "/api/pod/submit"], requireAnyAuth, (req, res, next) => {
  const role = String(req.user?.role ?? req.supabaseUser?.role ?? "").toLowerCase();
  if (role !== "fieldofficer") { next(); return; }
  const raw = req.body as Record<string, unknown>;
  const photoKeys = Array.isArray(raw.photoKeys)
    ? raw.photoKeys.filter((key) => typeof key === "string" && key.length > 0)
    : [];
  const photoGps = Array.isArray(raw.photoGpsCoords) ? raw.photoGpsCoords : [];
  if (photoKeys.length < 2) {
    res.status(422).json({ error: "Two required delivery photos must be uploaded before this PoD can be submitted" });
    return;
  }
  if (photoGps.length !== photoKeys.length) {
    res.status(422).json({ error: "Photo evidence and GPS metadata must remain aligned" });
    return;
  }
  const otpToken = typeof raw.otpVerificationToken === "string" ? raw.otpVerificationToken : "";
  const faceToken = typeof raw.faceVerificationToken === "string" ? raw.faceVerificationToken : "";
  if (!otpToken || !faceToken) {
    res.status(422).json({ error: "OTP and face verification steps must be completed before this PoD can be submitted" });
    return;
  }
  next();
});

export default router;
