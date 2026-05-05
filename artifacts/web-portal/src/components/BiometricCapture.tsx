import { useCallback, useEffect, useRef, useState } from "react";
import * as faceapi from "face-api.js";
import { Button } from "@/components/ui/button";
import { Camera, CheckCircle, Loader2, AlertCircle, RefreshCw } from "lucide-react";

const MODEL_URL = "https://cdn.jsdelivr.net/npm/face-api.js@0.22.2/weights";

type Phase = "loading_models" | "starting_cam" | "scanning" | "captured" | "done" | "error";

interface Props {
  farmerId: number;
  farmerName: string;
  onCapture: (blob: Blob) => Promise<void>;
  onSkip: () => void;
  uploading?: boolean;
}

export function BiometricCapture({ farmerId: _farmerId, farmerName, onCapture, onSkip, uploading = false }: Props) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const detectRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const [phase, setPhase] = useState<Phase>("loading_models");
  const [faceDetected, setFaceDetected] = useState(false);
  const [capturedBlob, setCapturedBlob] = useState<Blob | null>(null);
  const [error, setError] = useState<string | null>(null);

  const stopStream = useCallback(() => {
    if (detectRef.current) { clearInterval(detectRef.current); detectRef.current = null; }
    streamRef.current?.getTracks().forEach(t => t.stop());
    streamRef.current = null;
  }, []);

  // Load face-api models
  useEffect(() => {
    let cancelled = false;
    faceapi.nets.tinyFaceDetector.loadFromUri(MODEL_URL).then(() => {
      if (!cancelled) setPhase("starting_cam");
    }).catch(() => {
      if (!cancelled) { setError("Could not load face detection models — check internet."); setPhase("error"); }
    });
    return () => { cancelled = true; };
  }, []);

  // Start webcam
  useEffect(() => {
    if (phase !== "starting_cam") return;
    let cancelled = false;
    navigator.mediaDevices.getUserMedia({ video: { facingMode: "user", width: 640, height: 480 } })
      .then(stream => {
        if (cancelled) { stream.getTracks().forEach(t => t.stop()); return; }
        streamRef.current = stream;
        if (videoRef.current) videoRef.current.srcObject = stream;
        setPhase("scanning");
      })
      .catch(() => {
        if (!cancelled) { setError("Camera access denied. Please allow camera access and try again."); setPhase("error"); }
      });
    return () => { cancelled = true; };
  }, [phase]);

  // Face detection loop
  useEffect(() => {
    if (phase !== "scanning") return;
    detectRef.current = setInterval(async () => {
      if (!videoRef.current || videoRef.current.readyState < 2) return;
      const det = await faceapi.detectSingleFace(videoRef.current, new faceapi.TinyFaceDetectorOptions());
      setFaceDetected(!!det);
    }, 350);
    return () => { if (detectRef.current) clearInterval(detectRef.current); };
  }, [phase]);

  useEffect(() => () => stopStream(), [stopStream]);

  const capturePhoto = useCallback(() => {
    if (!videoRef.current || !canvasRef.current) return;
    const video = videoRef.current;
    const canvas = canvasRef.current;
    canvas.width = video.videoWidth || 640;
    canvas.height = video.videoHeight || 480;
    canvas.getContext("2d")!.drawImage(video, 0, 0);
    stopStream();
    setPhase("captured");
    canvas.toBlob(blob => {
      if (blob) setCapturedBlob(blob);
    }, "image/jpeg", 0.85);
  }, [stopStream]);

  const handleConfirm = async () => {
    if (!capturedBlob) return;
    await onCapture(capturedBlob);
    setPhase("done");
  };

  const handleRetake = () => {
    setCapturedBlob(null);
    setFaceDetected(false);
    setPhase("starting_cam");
  };

  return (
    <div className="space-y-3">
      {/* Camera / canvas viewport */}
      <div className="relative rounded-xl overflow-hidden bg-gray-900" style={{ aspectRatio: "4/3" }}>
        <video
          ref={videoRef}
          autoPlay
          playsInline
          muted
          className={`w-full h-full object-cover ${phase !== "scanning" ? "hidden" : ""}`}
        />
        <canvas
          ref={canvasRef}
          className={`w-full h-full object-cover ${phase !== "captured" && phase !== "done" ? "hidden" : ""}`}
        />

        {/* Loading overlay */}
        {(phase === "loading_models" || phase === "starting_cam") && (
          <div className="absolute inset-0 flex flex-col items-center justify-center bg-black/80 text-white gap-2">
            <Loader2 className="h-8 w-8 animate-spin text-green-400" />
            <span className="text-sm">{phase === "loading_models" ? "Loading models…" : "Starting camera…"}</span>
          </div>
        )}

        {/* Face oval guide */}
        {phase === "scanning" && (
          <div className="absolute inset-0 pointer-events-none flex items-center justify-center">
            <div className={`w-40 h-52 rounded-full border-4 transition-all duration-300 ${faceDetected ? "border-green-400 shadow-[0_0_20px_rgba(74,222,128,0.5)]" : "border-white/40"}`} />
            <div className="absolute bottom-3 left-0 right-0 flex justify-center">
              {faceDetected
                ? <span className="bg-green-600/90 backdrop-blur text-white text-xs px-3 py-1 rounded-full">Face detected ✓</span>
                : <span className="bg-black/50 backdrop-blur text-white/70 text-xs px-3 py-1 rounded-full">Position face in oval</span>
              }
            </div>
          </div>
        )}

        {/* Error overlay */}
        {phase === "error" && (
          <div className="absolute inset-0 flex flex-col items-center justify-center bg-black/85 text-white gap-3 p-6">
            <AlertCircle className="h-10 w-10 text-red-400" />
            <p className="text-sm text-center">{error}</p>
            <Button size="sm" variant="outline" className="text-white border-white/40" onClick={() => setPhase("starting_cam")}>
              <RefreshCw className="h-3 w-3 mr-1" /> Retry
            </Button>
          </div>
        )}

        {/* Confirmed badge */}
        {phase === "done" && (
          <div className="absolute inset-0 flex flex-col items-center justify-center bg-black/50 gap-2">
            <CheckCircle className="h-12 w-12 text-green-400" />
            <span className="text-white font-medium text-sm">Photo saved!</span>
          </div>
        )}
      </div>

      {/* Instruction */}
      {phase !== "done" && phase !== "error" && (
        <p className="text-xs text-muted-foreground text-center">
          Take a clear front-facing photo of <strong>{farmerName}</strong> for identity verification during future deliveries.
        </p>
      )}

      {/* Actions */}
      <div className="flex gap-2">
        {phase === "scanning" && (
          <Button
            type="button"
            onClick={capturePhoto}
            disabled={!faceDetected}
            className="flex-1 bg-green-700 hover:bg-green-800 text-white"
          >
            <Camera className="h-4 w-4 mr-2" />
            {faceDetected ? "Capture Photo" : "Waiting for face…"}
          </Button>
        )}

        {phase === "captured" && (
          <>
            <Button type="button" variant="outline" onClick={handleRetake} className="flex-1" disabled={uploading}>
              <RefreshCw className="h-4 w-4 mr-2" /> Retake
            </Button>
            <Button
              type="button"
              onClick={handleConfirm}
              disabled={uploading || !capturedBlob}
              className="flex-1 bg-green-700 hover:bg-green-800 text-white"
            >
              {uploading ? <><Loader2 className="h-4 w-4 mr-2 animate-spin" /> Saving…</> : <><CheckCircle className="h-4 w-4 mr-2" /> Use This Photo</>}
            </Button>
          </>
        )}

        {phase === "done" && (
          <div className="flex-1 flex items-center justify-center text-sm text-green-700 font-medium gap-1">
            <CheckCircle className="h-4 w-4" /> Biometric registered
          </div>
        )}

        {(phase === "scanning" || phase === "error") && (
          <Button type="button" variant="ghost" size="sm" onClick={onSkip} className="text-muted-foreground">
            Skip for now
          </Button>
        )}
      </div>
    </div>
  );
}
