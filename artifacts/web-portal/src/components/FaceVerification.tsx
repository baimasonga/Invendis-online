import { useEffect, useRef, useState, useCallback } from "react";
import { Button } from "@/components/ui/button";
import { Camera, CheckCircle, XCircle, Loader2, AlertCircle } from "lucide-react";
import * as faceapi from "face-api.js";

const MODEL_URL = "https://cdn.jsdelivr.net/npm/face-api.js@0.22.2/weights";

export type FaceResult =
  | { status: "match"; confidence: number; photoBlob: Blob }
  | { status: "no_match"; confidence: number; photoBlob: Blob }
  | { status: "no_ref"; photoBlob: Blob }
  | { status: "bypassed"; reason: string };

interface Props {
  farmerPhotoUrl?: string | null;
  farmerName: string;
  onResult: (result: FaceResult) => void;
  onBypass: (reason: string) => void;
}

type Phase = "loading_models" | "starting_cam" | "scanning" | "captured" | "comparing" | "done" | "error";

export function FaceVerification({ farmerPhotoUrl, farmerName, onResult, onBypass }: Props) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const detectIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const [phase, setPhase] = useState<Phase>("loading_models");
  const [faceDetected, setFaceDetected] = useState(false);
  const [result, setResult] = useState<FaceResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [showBypass, setShowBypass] = useState(false);
  const [bypassReason, setBypassReason] = useState("");
  const [modelsLoaded, setModelsLoaded] = useState(false);

  useEffect(() => {
    let cancelled = false;
    async function loadModels() {
      try {
        await Promise.all([
          faceapi.nets.tinyFaceDetector.loadFromUri(MODEL_URL),
          faceapi.nets.faceRecognitionNet.loadFromUri(MODEL_URL),
          faceapi.nets.faceLandmark68TinyNet.loadFromUri(MODEL_URL),
        ]);
        if (!cancelled) {
          setModelsLoaded(true);
          setPhase("starting_cam");
        }
      } catch {
        if (!cancelled) {
          setError("Failed to load face detection models. Check internet connection.");
          setPhase("error");
        }
      }
    }
    loadModels();
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    if (phase !== "starting_cam") return;
    let cancelled = false;
    async function startCam() {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: "user", width: 640, height: 480 } });
        if (cancelled) { stream.getTracks().forEach(t => t.stop()); return; }
        streamRef.current = stream;
        if (videoRef.current) videoRef.current.srcObject = stream;
        setPhase("scanning");
      } catch {
        if (!cancelled) {
          setError("Camera access denied. Please allow camera access.");
          setPhase("error");
        }
      }
    }
    startCam();
    return () => { cancelled = true; };
  }, [phase]);

  const stopStream = useCallback(() => {
    if (detectIntervalRef.current) { clearInterval(detectIntervalRef.current); detectIntervalRef.current = null; }
    streamRef.current?.getTracks().forEach(t => t.stop());
    streamRef.current = null;
  }, []);

  useEffect(() => {
    if (phase !== "scanning" || !modelsLoaded) return;
    detectIntervalRef.current = setInterval(async () => {
      if (!videoRef.current || videoRef.current.readyState < 2) return;
      const det = await faceapi.detectSingleFace(videoRef.current, new faceapi.TinyFaceDetectorOptions());
      setFaceDetected(!!det);
    }, 400);
    return () => { if (detectIntervalRef.current) clearInterval(detectIntervalRef.current); };
  }, [phase, modelsLoaded]);

  useEffect(() => {
    return () => stopStream();
  }, [stopStream]);

  const captureAndCompare = useCallback(async () => {
    if (!videoRef.current || !canvasRef.current) return;
    setPhase("captured");
    stopStream();

    const video = videoRef.current;
    const canvas = canvasRef.current;
    canvas.width = video.videoWidth || 640;
    canvas.height = video.videoHeight || 480;
    const ctx = canvas.getContext("2d")!;
    ctx.drawImage(video, 0, 0);

    const blob = await new Promise<Blob>(resolve =>
      canvas.toBlob(b => resolve(b!), "image/jpeg", 0.85)
    );

    if (!farmerPhotoUrl) {
      const r: FaceResult = { status: "no_ref", photoBlob: blob };
      setResult(r);
      onResult(r);
      setPhase("done");
      return;
    }

    setPhase("comparing");
    try {
      const [liveDesc, refDesc] = await Promise.all([
        getFaceDescriptor(canvas),
        getFaceDescriptorFromUrl(farmerPhotoUrl),
      ]);

      if (!liveDesc || !refDesc) {
        const r: FaceResult = { status: "no_ref", photoBlob: blob };
        setResult(r);
        onResult(r);
        setPhase("done");
        return;
      }

      const distance = faceapi.euclideanDistance(liveDesc, refDesc);
      const confidence = Math.round((1 - Math.min(distance, 1)) * 100);
      const matched = distance < 0.55;
      const r: FaceResult = matched
        ? { status: "match", confidence, photoBlob: blob }
        : { status: "no_match", confidence, photoBlob: blob };
      setResult(r);
      onResult(r);
      setPhase("done");
    } catch {
      const r: FaceResult = { status: "no_ref", photoBlob: blob };
      setResult(r);
      onResult(r);
      setPhase("done");
    }
  }, [farmerPhotoUrl, onResult, stopStream]);

  const handleBypass = () => {
    if (!bypassReason.trim()) return;
    stopStream();
    onBypass(bypassReason.trim());
  };

  return (
    <div className="space-y-3">
      <div className="relative rounded-xl overflow-hidden bg-gray-900 aspect-video">
        <video
          ref={videoRef}
          autoPlay
          playsInline
          muted
          className={`w-full h-full object-cover ${phase === "done" || phase === "captured" || phase === "comparing" ? "hidden" : ""}`}
        />
        <canvas
          ref={canvasRef}
          className={`w-full h-full object-cover ${phase === "done" || phase === "captured" || phase === "comparing" ? "block" : "hidden"}`}
        />

        {(phase === "loading_models" || phase === "starting_cam" || phase === "comparing") && (
          <div className="absolute inset-0 flex flex-col items-center justify-center bg-black/70 text-white gap-2">
            <Loader2 className="h-8 w-8 animate-spin" />
            <span className="text-sm">
              {phase === "loading_models" && "Loading face detection models…"}
              {phase === "starting_cam" && "Starting camera…"}
              {phase === "comparing" && "Comparing faces…"}
            </span>
          </div>
        )}

        {phase === "scanning" && (
          <div className="absolute inset-0 pointer-events-none">
            <div className={`absolute inset-8 rounded-full border-4 transition-colors ${faceDetected ? "border-green-400" : "border-white/30"}`} />
            {faceDetected && (
              <div className="absolute bottom-3 left-0 right-0 flex justify-center">
                <span className="bg-green-600 text-white text-xs px-3 py-1 rounded-full">Face detected ✓</span>
              </div>
            )}
          </div>
        )}

        {phase === "error" && (
          <div className="absolute inset-0 flex flex-col items-center justify-center bg-black/80 text-white gap-2 p-4">
            <AlertCircle className="h-8 w-8 text-red-400" />
            <span className="text-sm text-center">{error}</span>
          </div>
        )}
      </div>

      {phase === "done" && result && (
        <div className={`rounded-lg p-3 flex items-center gap-3 ${
          result.status === "match" ? "bg-green-50 border border-green-200" :
          result.status === "no_match" ? "bg-red-50 border border-red-200" :
          "bg-amber-50 border border-amber-200"
        }`}>
          {result.status === "match" && <CheckCircle className="h-5 w-5 text-green-600 shrink-0" />}
          {result.status === "no_match" && <XCircle className="h-5 w-5 text-red-600 shrink-0" />}
          {result.status === "no_ref" && <AlertCircle className="h-5 w-5 text-amber-600 shrink-0" />}
          <div>
            {result.status === "match" && (
              <p className="text-sm font-medium text-green-800">
                Face matched — {result.confidence}% confidence
              </p>
            )}
            {result.status === "no_match" && (
              <p className="text-sm font-medium text-red-800">
                Face did not match ({result.confidence}% confidence)
              </p>
            )}
            {result.status === "no_ref" && (
              <p className="text-sm font-medium text-amber-800">
                Photo captured. No registered photo to compare against.
              </p>
            )}
          </div>
        </div>
      )}

      <div className="flex gap-2">
        {phase === "scanning" && (
          <Button
            type="button"
            onClick={captureAndCompare}
            disabled={!faceDetected}
            className="flex-1 bg-green-700 hover:bg-green-800 text-white"
          >
            <Camera className="h-4 w-4 mr-2" />
            {faceDetected ? "Capture Face" : "Waiting for face…"}
          </Button>
        )}

        {phase === "done" && result?.status !== "bypassed" && (
          <div className="flex-1 flex items-center justify-center text-sm text-muted-foreground">
            Capture complete — continue to next step
          </div>
        )}

        {(phase === "scanning" || phase === "error" || phase === "done") && (
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => setShowBypass(v => !v)}
          >
            Bypass
          </Button>
        )}
      </div>

      {showBypass && (
        <div className="space-y-2 border rounded-lg p-3 bg-amber-50">
          <p className="text-xs text-amber-800 font-medium">Bypass biometric check — state reason:</p>
          <input
            className="w-full border rounded px-2 py-1 text-sm"
            placeholder="e.g. Camera malfunction, farmer disability…"
            value={bypassReason}
            onChange={e => setBypassReason(e.target.value)}
          />
          <Button type="button" size="sm" variant="outline" onClick={handleBypass} disabled={!bypassReason.trim()}>
            Confirm Bypass
          </Button>
        </div>
      )}

      {farmerPhotoUrl && phase === "scanning" && (
        <div className="flex items-center gap-2">
          <span className="text-xs text-muted-foreground">Reference photo for {farmerName}:</span>
          <img src={farmerPhotoUrl} alt="Farmer" className="h-10 w-10 rounded-full object-cover border" />
        </div>
      )}
    </div>
  );
}

async function getFaceDescriptor(input: HTMLCanvasElement | HTMLImageElement): Promise<Float32Array | null> {
  const det = await faceapi
    .detectSingleFace(input, new faceapi.TinyFaceDetectorOptions())
    .withFaceLandmarks(true)
    .withFaceDescriptor();
  return det?.descriptor ?? null;
}

async function getFaceDescriptorFromUrl(url: string): Promise<Float32Array | null> {
  return new Promise(resolve => {
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = async () => {
      const desc = await getFaceDescriptor(img as unknown as HTMLImageElement);
      resolve(desc);
    };
    img.onerror = () => resolve(null);
    img.src = url;
  });
}
