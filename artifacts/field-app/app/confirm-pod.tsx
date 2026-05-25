import { Feather } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import { useLocalSearchParams, useNavigation, useRouter } from "expo-router";
import React, { useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  BackHandler,
  Image,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useAuth } from "@/context/AuthContext";
import { useOfflineQueue } from "@/context/OfflineQueueContext";
import { useColors } from "@/hooks/useColors";
import {
  sendOtp,
  verifyOtp,
  submitPoD,
  getFaceUploadUrl,
  getPodPhotoUploadUrl,
  compareFace,
  saveFaceReference,
  uploadPhotoToS3,
  getOtpStatus,
  bypassOtp,
  inputByBarcode,
  type OtpSendResult,
  type FaceCompareResult,
  type PoD,
  type InputItem,
} from "@/lib/api";

let CameraView: React.ComponentType<{
  style?: any;
  onBarcodeScanned?: (data: { data: string }) => void;
  barcodeScannerSettings?: { barcodeTypes: string[] };
}> | null = null;
try {
  const cam = require("expo-camera");
  CameraView = cam.CameraView;
} catch (_) {}

interface GPSCoords {
  latitude: number;
  longitude: number;
  accuracy?: number;
}

async function getLocation(): Promise<GPSCoords | null> {
  if (Platform.OS === "web") {
    return new Promise((resolve) => {
      if (!navigator.geolocation) { resolve(null); return; }
      navigator.geolocation.getCurrentPosition(
        (pos) => resolve({ latitude: pos.coords.latitude, longitude: pos.coords.longitude, accuracy: pos.coords.accuracy }),
        () => resolve(null),
        { timeout: 8000 }
      );
    });
  }
  try {
    const Location = require("expo-location");
    const { status } = await Location.requestForegroundPermissionsAsync();
    if (status !== "granted") return null;
    const pos = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });
    return { latitude: pos.coords.latitude, longitude: pos.coords.longitude, accuracy: pos.coords.accuracy };
  } catch {
    return null;
  }
}

async function takeCameraPhoto(): Promise<string | null> {
  if (Platform.OS === "web") return null;
  try {
    const ImagePicker = require("expo-image-picker");
    const { status } = await ImagePicker.requestCameraPermissionsAsync();
    if (status !== "granted") {
      Alert.alert("Permission Required", "Camera access is needed to verify the farmer's identity.");
      return null;
    }
    const result = await ImagePicker.launchCameraAsync({
      mediaTypes: ["images"] as any,
      allowsEditing: false,
      quality: 0.8,
    });
    if (result.canceled || !result.assets?.[0]?.uri) return null;
    return result.assets[0].uri;
  } catch {
    return null;
  }
}

const OTP_LENGTH = 6;
const RESEND_SECONDS = 60;

type Step = "details" | "scan" | "otp" | "photos" | "face" | "result";

interface DeliveryPhoto {
  label: string;
  uri: string | null;
  key: string | null;
  uploading: boolean;
  error: string | null;
  gps: GPSCoords | null;
}

const PHOTO_SLOTS = [
  "Inputs Only",
  "Inputs + Beneficiary",
  "Farmer Receiving",
  "Community / Group",
  "Additional Evidence",
];

// Indices of photos that MUST be captured before proceeding to Face ID
const REQUIRED_PHOTO_INDICES = [0, 2]; // "Inputs Only" + "Farmer Receiving"

export default function ConfirmPodScreen() {
  const { farmerId, farmerName, farmerCode, dispatchId, beneficiaryType, groupSize, contactName } = useLocalSearchParams<{
    farmerId: string;
    farmerName: string;
    farmerCode: string;
    dispatchId?: string;
    beneficiaryType?: string;
    groupSize?: string;
    contactName?: string;
  }>();
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const { token } = useAuth();
  const { enqueue } = useOfflineQueue();
  const router = useRouter();
  const navigation = useNavigation();

  const [step, setStep] = useState<Step>("details");

  // Details
  const [quantity, setQuantity] = useState("1");
  const [notes, setNotes] = useState("");
  const [actualGroupSize, setActualGroupSize] = useState(groupSize || "");
  const [gps, setGps] = useState<GPSCoords | null>(null);
  const [gpsLoading, setGpsLoading] = useState(false);

  // OTP
  const [otpEnabled, setOtpEnabled] = useState(true);
  const [otpResult, setOtpResult] = useState<OtpSendResult | null>(null);
  const [smsDeliveryFailed, setSmsDeliveryFailed] = useState(false);
  const [devCode, setDevCode] = useState<string | null>(null);
  const [digits, setDigits] = useState<string[]>(Array(OTP_LENGTH).fill(""));
  const [sendingOtp, setSendingOtp] = useState(false);
  const [verifying, setVerifying] = useState(false);
  const [otpError, setOtpError] = useState<string | null>(null);
  const [resendTimer, setResendTimer] = useState(0);
  const [verifiedOtpCode, setVerifiedOtpCode] = useState<string | null>(null);
  const inputRefs = useRef<(TextInput | null)[]>([]);
  const [otpBypassed, setOtpBypassed] = useState(false);

  // Delivery photos
  const [deliveryPhotos, setDeliveryPhotos] = useState<DeliveryPhoto[]>(
    PHOTO_SLOTS.map(label => ({ label, uri: null, key: null, uploading: false, error: null, gps: null }))
  );

  // Face
  const [facePhotoUri, setFacePhotoUri] = useState<string | null>(null);
  const [facePhotoKey, setFacePhotoKey] = useState<string | null>(null);
  const [faceResult, setFaceResult] = useState<FaceCompareResult | null>(null);
  const [faceLoading, setFaceLoading] = useState(false);
  const [faceError, setFaceError] = useState<string | null>(null);

  // Input scan
  const [scannedBarcode, setScannedBarcode] = useState("");
  const [scannedItem, setScannedItem] = useState<InputItem | null>(null);
  const [scanError, setScanError] = useState<string | null>(null);
  const [scanLoading, setScanLoading] = useState(false);
  const [cameraOpen, setCameraOpen] = useState(false);

  // Submit
  const [submitting, setSubmitting] = useState(false);
  const [submittedPod, setSubmittedPod] = useState<PoD | null>(null);

  const bottomPad = Platform.OS === "web" ? 34 : insets.bottom;

  useEffect(() => {
    captureGPS();
    if (token) {
      getOtpStatus(token)
        .then((s) => setOtpEnabled(s.otpEnabled))
        .catch(() => {});
    }
  }, []);

  useEffect(() => {
    if (Platform.OS !== "android") return;
    if (step === "result") return;
    if (step === "details") return;
    const sub = BackHandler.addEventListener("hardwareBackPress", () => {
      Alert.alert(
        "Discard Delivery?",
        "Going back will discard this PoD. Are you sure?",
        [
          { text: "Stay", style: "cancel" },
          { text: "Discard", style: "destructive", onPress: () => router.back() },
        ]
      );
      return true;
    });
    return () => sub.remove();
  }, [step]);

  // iOS swipe-back guard — mirrors the Android BackHandler behaviour
  useEffect(() => {
    if (Platform.OS !== "ios") return;
    if (step === "result" || step === "details") return;
    const unsubscribe = navigation.addListener("beforeRemove" as any, (e: any) => {
      e.preventDefault();
      Alert.alert(
        "Discard Delivery?",
        "Going back will discard this PoD. Are you sure?",
        [
          { text: "Stay", style: "cancel" },
          { text: "Discard", style: "destructive", onPress: () => navigation.dispatch(e.data.action) },
        ]
      );
    });
    return unsubscribe;
  }, [navigation, step]);
  useEffect(() => {
    if (resendTimer <= 0) return;
    const t = setTimeout(() => setResendTimer((s) => s - 1), 1000);
    return () => clearTimeout(t);
  }, [resendTimer]);

  const captureGPS = async () => {
    setGpsLoading(true);
    setGps(await getLocation());
    setGpsLoading(false);
  };

  const handleSendOtp = async () => {
    const qty = Number(quantity);
    if (isNaN(qty) || qty <= 0) {
      Alert.alert("Invalid Quantity", "Please enter a valid quantity before verifying.");
      return;
    }
    setSendingOtp(true);
    setOtpError(null);
    setSmsDeliveryFailed(false);
    try {
      const result = await sendOtp(token!, Number(farmerId), dispatchId ? { dispatchId: Number(dispatchId) } : undefined);
      setOtpResult(result);
      setDevCode(result.devCode ?? null);
      setDigits(Array(OTP_LENGTH).fill(""));
      setResendTimer(RESEND_SECONDS);
      if (result.deliveryFailed) setSmsDeliveryFailed(true);
      setStep("otp");
      await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Could not send verification code";
      if (msg.toLowerCase().includes("no registered phone")) {
        Alert.alert(
          "No Phone Number",
          "This farmer has no registered phone number. You can submit without SMS verification, but the record will be flagged.",
          [
            { text: "Cancel", style: "cancel" },
            { text: "Submit Anyway", onPress: () => doSubmit("NoPhone", "Bypassed") },
          ]
        );
      } else {
        Alert.alert("SMS Error", msg);
      }
    } finally {
      setSendingOtp(false);
    }
  };

  const handleSkipOtp = () => {
    const reason = smsDeliveryFailed
      ? "SMS delivery failed — no network coverage"
      : !otpEnabled
      ? "OTP verification disabled by administrator"
      : "No SMS coverage";

    Alert.alert(
      "Skip OTP Verification",
      `This delivery will proceed without SMS confirmation.\n\nReason: ${reason}\n\nThe record will be flagged for supervisor review.`,
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Skip & Continue",
          style: "destructive",
          onPress: async () => {
            let auditFailed = false;
            try {
              await bypassOtp(
                token!,
                Number(farmerId),
                dispatchId ? Number(dispatchId) : undefined,
                reason
              );
            } catch {
              auditFailed = true;
            }
            setOtpBypassed(true);
            setFacePhotoUri(null);
            setFaceResult(null);
            setFaceError(null);
            setStep("photos");
            await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
            if (auditFailed) {
              Alert.alert(
                "Audit Log Warning",
                "OTP bypass could not be recorded on the server. The delivery will still be saved, but please inform your supervisor.",
                [{ text: "OK" }]
              );
            }
          },
        },
      ]
    );
  };

  const handleDigitChange = (text: string, index: number) => {
    const val = text.replace(/\D/g, "").slice(-1);
    const next = [...digits];
    next[index] = val;
    setDigits(next);
    setOtpError(null);
    if (val && index < OTP_LENGTH - 1) inputRefs.current[index + 1]?.focus();
    if (val && next.every((d) => d !== "")) handleVerify(next.join(""));
  };

  const handleDigitKeyPress = (key: string, index: number) => {
    if (key === "Backspace" && !digits[index] && index > 0) inputRefs.current[index - 1]?.focus();
  };

  const handleVerify = async (code?: string) => {
    const enteredCode = code ?? digits.join("");
    if (enteredCode.length < OTP_LENGTH) { setOtpError("Please enter all 6 digits."); return; }
    setVerifying(true);
    setOtpError(null);
    try {
      const result = await verifyOtp(token!, Number(farmerId), enteredCode);
      if (result.verified) {
        await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
        setVerifiedOtpCode(enteredCode);
        setFacePhotoUri(null);
        setFaceResult(null);
        setFaceError(null);
        setStep("photos");
      } else {
        setOtpError(result.error ?? "Invalid code. Please try again.");
        await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
      }
    } catch (e) {
      setOtpError(e instanceof Error ? e.message : "Verification failed");
      await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
    } finally {
      setVerifying(false);
    }
  };

  const handleResend = async () => {
    if (resendTimer > 0) return;
    setSendingOtp(true);
    setOtpError(null);
    try {
      const result = await sendOtp(token!, Number(farmerId), dispatchId ? { dispatchId: Number(dispatchId) } : undefined);
      setOtpResult(result);
      setDevCode(result.devCode ?? null);
      setDigits(Array(OTP_LENGTH).fill(""));
      setResendTimer(RESEND_SECONDS);
      if (result.deliveryFailed) setSmsDeliveryFailed(true);
      else setSmsDeliveryFailed(false);
    } catch (e) {
      setOtpError(e instanceof Error ? e.message : "Failed to resend code");
    } finally {
      setSendingOtp(false);
    }
  };

  const handleTakePhoto = async () => {
    setFaceError(null);
    const uri = await takeCameraPhoto();
    if (!uri) return;
    setFacePhotoUri(uri);
    setFaceResult(null);
    setFaceLoading(true);
    try {
      const uploadInfo = await getFaceUploadUrl(token!, Number(farmerId), "delivery");
      await uploadPhotoToS3(uploadInfo.uploadUrl, uri);
      setFacePhotoKey(uploadInfo.key);
      const result = await compareFace(token!, Number(farmerId), uploadInfo.key);

      // When no reference photo exists, save this delivery photo as the reference
      // so all future deliveries compare against it.
      if (result.faceStatus === "NoReference") {
        try {
          await saveFaceReference(token!, Number(farmerId), uploadInfo.key);
        } catch (refErr) {
          // Non-fatal — log but don't block the flow
          console.warn("Could not save reference photo:", refErr);
        }
      }

      setFaceResult(result);
      if (result.faceStatus === "Verified" || result.faceStatus === "NoReference") {
        await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      } else {
        await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
      }
    } catch (e) {
      setFaceError(e instanceof Error ? e.message : "Face verification failed");
      await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
    } finally {
      setFaceLoading(false);
    }
  };

  const handleFaceOverride = () => {
    Alert.alert(
      "Override Face Verification",
      "Are you sure you want to submit without a face match? This exception will be flagged for supervisor review.",
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Override & Submit",
          style: "destructive",
          onPress: () => doSubmit(otpBypassed ? "SMSBypass" : "Verified", faceResult?.faceStatus ?? "Failed"),
        },
      ]
    );
  };

  const handleVerifyBarcode = async (code: string) => {
    const trimmed = code.trim();
    if (!trimmed) return;
    setScanLoading(true);
    setScanError(null);
    setScannedItem(null);
    try {
      const item = await inputByBarcode(token!, trimmed);
      setScannedItem(item);
      setScannedBarcode(trimmed);
      await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    } catch {
      setScanError("No matching input item found for this barcode.");
      await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
    } finally {
      setScanLoading(false);
    }
  };

  const handleSkipScan = () => {
    setScannedBarcode("");
    setScannedItem(null);
    setScanError(null);
    if (otpEnabled) setStep("otp");
    else handleSkipOtp();
  };

  const handleTakeDeliveryPhoto = async (index: number) => {
    const [uri, photoGps] = await Promise.all([takeCameraPhoto(), getLocation()]);
    if (!uri) return;
    setDeliveryPhotos(prev => prev.map((p, i) =>
      i === index ? { ...p, uri, key: null, uploading: true, error: null, gps: photoGps } : p
    ));
    try {
      const uploadInfo = await getPodPhotoUploadUrl(token!, Number(farmerId), index);
      await uploadPhotoToS3(uploadInfo.uploadUrl, uri);
      setDeliveryPhotos(prev => prev.map((p, i) =>
        i === index ? { ...p, key: uploadInfo.key, uploading: false } : p
      ));
      await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    } catch (e) {
      setDeliveryPhotos(prev => prev.map((p, i) =>
        i === index ? { ...p, uploading: false, error: e instanceof Error ? e.message : "Upload failed" } : p
      ));
      await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
    }
  };

  const buildPayload = (otpStatus: string, faceStatus: string): Record<string, unknown> => ({
    farmerId: Number(farmerId),
    ...(farmerName ? { farmerName } : {}),
    ...(dispatchId ? { dispatchId: Number(dispatchId) } : {}),
    quantityDelivered: Number(quantity),
    otpStatus,
    faceStatus,
    ...(gps ? { farmerLatitude: gps.latitude, farmerLongitude: gps.longitude } : {}),
    ...(scannedItem ? { inputItemId: scannedItem.id } : {}),
    ...(scannedBarcode ? { inputBarcode: scannedBarcode } : {}),
    ...(notes.trim() ? { notes: notes.trim() } : {}),
    ...(verifiedOtpCode ? { otpCode: verifiedOtpCode } : {}),
    photoKeys: deliveryPhotos.filter(p => p.key).map(p => p.key),
    photoGpsCoords: deliveryPhotos.map(p => p.gps ? { lat: p.gps.latitude, lng: p.gps.longitude, ...(p.gps.accuracy != null ? { accuracy: p.gps.accuracy } : {}) } : null),
    ...(facePhotoKey ? { facePhotoKey } : {}),
    ...(faceResult?.similarity != null ? { faceSimilarity: faceResult.similarity } : {}),
    ...(beneficiaryType === "group" && actualGroupSize ? { actualGroupSize: Number(actualGroupSize) } : {}),
  });

  const doSubmit = async (otpStatus: string, faceStatus: string, offline = false) => {
    const payload = buildPayload(otpStatus, faceStatus);
    setSubmitting(true);
    try {
      if (offline) {
        await enqueue(payload);
        await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
        Alert.alert("Saved Offline", "PoD queued. It will sync when you're back online.", [
          { text: "OK", onPress: () => router.back() },
        ]);
      } else {
        const pod = await submitPoD(token!, payload);
        await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
        setSubmittedPod(pod);
        setStep("result");
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Failed to submit";
      Alert.alert(
        "Submission Failed",
        `${msg}\n\nSave offline and sync later?`,
        [
          { text: "Cancel", style: "cancel" },
          { text: "Save Offline", onPress: () => doSubmit(otpStatus, faceStatus, true) },
        ]
      );
    } finally {
      setSubmitting(false);
    }
  };

  const StepIndicator = () => {
    const steps = [
      { key: "details", label: "Details", icon: "clipboard" as const },
      { key: "scan",    label: "Input",   icon: "package" as const },
      { key: "otp",     label: "OTP",     icon: "shield" as const },
      { key: "photos",  label: "Photos",  icon: "image" as const },
      { key: "face",    label: "Face ID", icon: "camera" as const },
    ];
    const currentIdx = steps.findIndex((s) => s.key === step);
    return (
      <View style={styles.stepBar}>
        {steps.map((s, i) => {
          const done = i < currentIdx;
          const active = i === currentIdx;
          return (
            <React.Fragment key={s.key}>
              <View style={styles.stepItem}>
                <View style={[
                  styles.stepCircle,
                  {
                    backgroundColor: done ? colors.success : active ? colors.primary : colors.muted,
                    borderColor: done ? colors.success : active ? colors.primary : colors.border,
                  },
                ]}>
                  {done
                    ? <Feather name="check" size={12} color="#fff" />
                    : <Feather name={s.icon} size={12} color={active ? "#fff" : colors.mutedForeground} />
                  }
                </View>
                <Text style={[styles.stepLabel, { color: active ? colors.primary : done ? colors.success : colors.mutedForeground }]}>
                  {s.label}
                </Text>
              </View>
              {i < steps.length - 1 && (
                <View style={[styles.stepLine, { backgroundColor: i < currentIdx ? colors.success : colors.border }]} />
              )}
            </React.Fragment>
          );
        })}
      </View>
    );
  };

  // ═══════════════════════════════════════════════════════════════════════════
  // STEP 4 — Result (GPS verification outcome)
  // ═══════════════════════════════════════════════════════════════════════════
  if (step === "result" && submittedPod) {
    const gpsStatus = submittedPod.gpsStatus;
    const gpsCfg: Record<string, { icon: "map-pin" | "alert-triangle" | "wifi-off" | "clock"; title: string; desc: string; colorKey: "success" | "warning" | "mutedForeground" }> = {
      Verified:   { icon: "map-pin",       title: "Location Verified",     desc: "Delivery confirmed within the expected distribution zone.",          colorKey: "success"          },
      Mismatch:   { icon: "alert-triangle", title: "Location Outside Zone", desc: "Delivery recorded outside the expected area — flagged for review.", colorKey: "warning"          },
      NoLocation: { icon: "wifi-off",       title: "No GPS Captured",       desc: "No coordinates were recorded for this delivery.",                   colorKey: "mutedForeground"  },
    };
    const cfg = gpsCfg[gpsStatus ?? ""] ?? { icon: "clock" as const, title: "GPS Pending", desc: "No destination coordinates configured for this campaign.", colorKey: "mutedForeground" as const };
    const gpsColor = colors[cfg.colorKey as keyof typeof colors] as string;
    const faceOk = submittedPod.faceStatus === "Verified" || submittedPod.faceStatus === "NoReference";

    return (
      <ScrollView
        style={[styles.root, { backgroundColor: colors.background }]}
        contentContainerStyle={[styles.content, { paddingBottom: bottomPad + 40, alignItems: "center" }]}
      >
        {/* Success icon */}
        <View style={[resultStyles.successRing, { backgroundColor: colors.success + "18", borderColor: colors.success + "35" }]}>
          <View style={[resultStyles.successInner, { backgroundColor: colors.success + "30" }]}>
            <Feather name="check-circle" size={44} color={colors.success} />
          </View>
        </View>

        <Text style={[resultStyles.successTitle, { color: colors.foreground }]}>PoD Recorded!</Text>
        <Text style={[resultStyles.podCode, { color: colors.primary }]}>{submittedPod.podCode}</Text>
        <Text style={[resultStyles.farmerLabel, { color: colors.mutedForeground, marginBottom: (beneficiaryType === "group" && contactName) ? 0 : 20 }]}>
          {farmerName} · {quantity} unit{Number(quantity) !== 1 ? "s" : ""}
        </Text>
        {beneficiaryType === "group" && contactName && (
          <Text style={[resultStyles.contactLabel, { color: colors.mutedForeground }]}>Contact: {contactName}</Text>
        )}

        {/* GPS / community status card */}
        <View style={[resultStyles.gpsCard, { backgroundColor: gpsColor + "14", borderColor: gpsColor + "35", borderRadius: colors.radius, width: "100%" }]}>
          <View style={[resultStyles.gpsIconWrap, { backgroundColor: gpsColor + "22" }]}>
            <Feather name={cfg.icon} size={26} color={gpsColor} />
          </View>
          <Text style={[resultStyles.gpsTitle, { color: gpsColor }]}>{cfg.title}</Text>
          {submittedPod.communityName ? (
            <Text style={[resultStyles.gpsDesc, { color: colors.foreground, fontWeight: "600", marginBottom: 2 }]}>
              Community: {submittedPod.communityName}
            </Text>
          ) : null}
          <Text style={[resultStyles.gpsDesc, { color: colors.mutedForeground }]}>{cfg.desc}</Text>
          {submittedPod.farmerLatitude != null && submittedPod.farmerLongitude != null && (
            <Text style={[resultStyles.gpsCoords, { color: colors.mutedForeground }]}>
              {(submittedPod.farmerLatitude as number).toFixed(5)}, {(submittedPod.farmerLongitude as number).toFixed(5)}
            </Text>
          )}
        </View>

        {/* Verification summary */}
        <View style={[resultStyles.summaryCard, { backgroundColor: colors.muted, borderRadius: colors.radius, width: "100%" }]}>
          {[
            { icon: "package" as const,  label: "Input",      val: scannedItem?.name ?? (scannedBarcode || "Not scanned"), ok: !!scannedItem },
            { icon: "shield" as const,   label: "OTP",        val: submittedPod.otpStatus ?? "—",  ok: submittedPod.otpStatus === "Verified" },
            { icon: "image" as const,    label: "Photos",     val: `${((submittedPod as any).photoKeys?.length ?? 0)} captured`, ok: ((submittedPod as any).photoKeys?.length ?? 0) >= 5 },
            { icon: "camera" as const,   label: "Face ID",    val: submittedPod.faceStatus ?? "—", ok: faceOk },
            { icon: "map-pin" as const,  label: "GPS",        val: gpsStatus ?? "Pending",          ok: gpsStatus === "Verified" },
          ].map(({ icon, label, val, ok }) => (
            <View key={label} style={resultStyles.summaryRow}>
              <Feather name={icon} size={14} color={ok ? colors.success : colors.mutedForeground} />
              <Text style={[resultStyles.summaryLabel, { color: colors.mutedForeground }]}>{label}</Text>
              <Text style={[resultStyles.summaryVal, { color: ok ? colors.success : colors.mutedForeground }]}>{val}</Text>
            </View>
          ))}
        </View>

        {/* Done button */}
        <TouchableOpacity
          style={[resultStyles.doneBtn, { backgroundColor: colors.primary, borderRadius: colors.radius, width: "100%" }]}
          onPress={() => router.back()}
          activeOpacity={0.85}
        >
          <Feather name="check" size={18} color="#fff" />
          <Text style={resultStyles.doneBtnText}>Done</Text>
        </TouchableOpacity>
      </ScrollView>
    );
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // STEP 1 — Details
  // ═══════════════════════════════════════════════════════════════════════════
  if (step === "details") {
    return (
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === "ios" ? "padding" : undefined}>
        <ScrollView
          style={[styles.root, { backgroundColor: colors.background }]}
          contentContainerStyle={[styles.content, { paddingBottom: bottomPad + 32 }]}
          keyboardShouldPersistTaps="handled"
        >
          <StepIndicator />
          <View style={[styles.section, { backgroundColor: colors.card, borderColor: colors.border, borderRadius: colors.radius }]}>
            <Text style={[styles.sectionLabel, { color: colors.mutedForeground }]}>Beneficiary</Text>
            <View style={styles.farmerRow}>
              <View style={[styles.farmerAvatar, { backgroundColor: colors.primary + "18" }]}>
                <Feather name={beneficiaryType === "group" ? "users" : "user"} size={24} color={colors.primary} />
              </View>
              <View style={{ flex: 1, gap: 3 }}>
                <Text style={[styles.farmerName, { color: colors.foreground }]}>{farmerName}</Text>
                {beneficiaryType === "group" && contactName && (
                  <Text style={[styles.farmerContact, { color: colors.mutedForeground }]}>Contact: {contactName}</Text>
                )}
                <Text style={[styles.farmerCode, { color: colors.mutedForeground }]}>{farmerCode}</Text>
                {beneficiaryType === "group" && (
                  <View style={[styles.groupBadge, { backgroundColor: colors.primary + "15", borderColor: colors.primary + "40" }]}>
                    <Feather name="users" size={11} color={colors.primary} />
                    <Text style={[styles.groupBadgeText, { color: colors.primary }]}>
                      Group{groupSize ? ` · ${groupSize} members` : ""}
                    </Text>
                  </View>
                )}
              </View>
            </View>
          </View>

          {beneficiaryType === "group" && (
            <View style={[styles.section, { backgroundColor: colors.card, borderColor: colors.border, borderRadius: colors.radius }]}>
              <Text style={[styles.sectionLabel, { color: colors.mutedForeground }]}>Members Present</Text>
              <View style={styles.qtyRow}>
                <TouchableOpacity
                  style={[styles.qtyBtn, { backgroundColor: colors.muted, borderRadius: colors.radius }]}
                  onPress={() => setActualGroupSize(v => String(Math.max(1, Number(v || groupSize || 1) - 1)))}
                >
                  <Feather name="minus" size={18} color={colors.foreground} />
                </TouchableOpacity>
                <TextInput
                  style={[styles.qtyInput, { borderColor: colors.border, color: colors.foreground, borderRadius: colors.radius }]}
                  value={actualGroupSize}
                  onChangeText={setActualGroupSize}
                  keyboardType="numeric"
                  textAlign="center"
                  placeholder={groupSize || "Count"}
                  placeholderTextColor={colors.mutedForeground}
                />
                <TouchableOpacity
                  style={[styles.qtyBtn, { backgroundColor: colors.muted, borderRadius: colors.radius }]}
                  onPress={() => setActualGroupSize(v => String(Number(v || groupSize || 0) + 1))}
                >
                  <Feather name="plus" size={18} color={colors.foreground} />
                </TouchableOpacity>
              </View>
              {groupSize ? (
                <Text style={{ fontSize: 11, color: colors.mutedForeground, marginTop: 4 }}>
                  Registered: {groupSize} members
                </Text>
              ) : null}
            </View>
          )}

          <View style={[styles.section, { backgroundColor: colors.card, borderColor: colors.border, borderRadius: colors.radius }]}>
            <Text style={[styles.sectionLabel, { color: colors.mutedForeground }]}>GPS Location</Text>
            {gpsLoading ? (
              <View style={styles.gpsRow}>
                <ActivityIndicator color={colors.primary} size="small" />
                <Text style={[styles.gpsText, { color: colors.mutedForeground }]}>Acquiring location…</Text>
              </View>
            ) : gps ? (
              <View style={styles.gpsRow}>
                <Feather name="map-pin" size={16} color={colors.success} />
                <Text style={[styles.gpsText, { color: colors.foreground }]}>
                  {gps.latitude.toFixed(5)}, {gps.longitude.toFixed(5)}
                </Text>
                {gps.accuracy && <Text style={[styles.gpsAccuracy, { color: colors.mutedForeground }]}>±{Math.round(gps.accuracy)}m</Text>}
              </View>
            ) : (
              <View style={styles.gpsRow}>
                <Feather name="alert-circle" size={16} color={colors.warning} />
                <Text style={[styles.gpsText, { color: colors.warning }]}>Location unavailable</Text>
                <TouchableOpacity onPress={captureGPS}>
                  <Text style={[styles.retry, { color: colors.primary }]}>Retry</Text>
                </TouchableOpacity>
              </View>
            )}
          </View>

          <View style={[styles.section, { backgroundColor: colors.card, borderColor: colors.border, borderRadius: colors.radius }]}>
            <Text style={[styles.sectionLabel, { color: colors.mutedForeground }]}>Quantity Issued</Text>
            <View style={styles.qtyRow}>
              <TouchableOpacity
                style={[styles.qtyBtn, { backgroundColor: colors.muted, borderRadius: colors.radius }]}
                onPress={() => setQuantity((v) => String(Math.max(1, Number(v) - 1)))}
              >
                <Feather name="minus" size={18} color={colors.foreground} />
              </TouchableOpacity>
              <TextInput
                style={[styles.qtyInput, { borderColor: colors.border, color: colors.foreground, borderRadius: colors.radius }]}
                value={quantity}
                onChangeText={setQuantity}
                keyboardType="numeric"
                textAlign="center"
              />
              <TouchableOpacity
                style={[styles.qtyBtn, { backgroundColor: colors.muted, borderRadius: colors.radius }]}
                onPress={() => setQuantity((v) => String(Number(v) + 1))}
              >
                <Feather name="plus" size={18} color={colors.foreground} />
              </TouchableOpacity>
            </View>
          </View>

          <View style={[styles.section, { backgroundColor: colors.card, borderColor: colors.border, borderRadius: colors.radius }]}>
            <Text style={[styles.sectionLabel, { color: colors.mutedForeground }]}>Notes (optional)</Text>
            <TextInput
              style={[styles.notesInput, { borderColor: colors.border, color: colors.foreground, backgroundColor: colors.muted, borderRadius: colors.radius }]}
              value={notes}
              onChangeText={setNotes}
              placeholder="Any additional notes…"
              placeholderTextColor={colors.mutedForeground}
              multiline
              numberOfLines={3}
            />
          </View>

          {dispatchId && (
            <View style={[styles.dispatchBadge, { backgroundColor: colors.muted, borderRadius: colors.radius }]}>
              <Feather name="truck" size={14} color={colors.mutedForeground} />
              <Text style={[styles.dispatchText, { color: colors.mutedForeground }]}>Dispatch #{dispatchId}</Text>
            </View>
          )}

          {!otpEnabled && (
            <View style={[styles.skipBanner, { backgroundColor: colors.warning + "18", borderColor: colors.warning + "50", borderRadius: colors.radius }]}>
              <Feather name="info" size={15} color={colors.warning} />
              <Text style={[styles.skipBannerText, { color: colors.warning }]}>
                OTP verification is disabled. You can skip directly to face verification.
              </Text>
            </View>
          )}

          <View style={[styles.actions, { flexWrap: "wrap" }]}>
            <TouchableOpacity
              style={[styles.offlineBtn, { borderColor: colors.border, borderRadius: colors.radius }]}
              onPress={() => doSubmit("Bypassed", "Bypassed", true)}
              disabled={sendingOtp || submitting}
              activeOpacity={0.8}
            >
              <Feather name="wifi-off" size={16} color={colors.mutedForeground} />
              <Text style={[styles.offlineBtnText, { color: colors.mutedForeground }]}>Save Offline</Text>
            </TouchableOpacity>
            {!otpEnabled && (
              <TouchableOpacity
                style={[styles.skipOtpBtn, { borderColor: colors.warning + "80", borderRadius: colors.radius }]}
                onPress={handleSkipOtp}
                disabled={sendingOtp || submitting}
                activeOpacity={0.8}
              >
                <Feather name="skip-forward" size={16} color={colors.warning} />
                <Text style={[styles.offlineBtnText, { color: colors.warning }]}>Skip OTP</Text>
              </TouchableOpacity>
            )}
            <TouchableOpacity
              style={[styles.submitBtn, { backgroundColor: colors.primary, borderRadius: colors.radius }]}
              onPress={() => setStep("scan")}
              disabled={submitting}
              activeOpacity={0.85}
            >
              <Feather name="package" size={18} color="#fff" />
              <Text style={styles.submitBtnText}>Next: Scan Input</Text>
            </TouchableOpacity>
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    );
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // STEP 2 — Input Barcode Scan
  // ═══════════════════════════════════════════════════════════════════════════
  if (step === "scan") {
    const proceedToOtp = () => {
      if (otpEnabled) setStep("otp");
      else handleSkipOtp();
    };

    if (cameraOpen && Platform.OS !== "web" && CameraView) {
      return (
        <View style={{ flex: 1, backgroundColor: "#000" }}>
          <CameraView
            style={{ flex: 1 }}
            onBarcodeScanned={({ data }) => {
              setCameraOpen(false);
              setScannedBarcode(data);
              handleVerifyBarcode(data);
            }}
            barcodeScannerSettings={{ barcodeTypes: ["code128", "qr", "code39", "ean13", "code93"] }}
          />
          <TouchableOpacity
            onPress={() => setCameraOpen(false)}
            style={{ position: "absolute", top: insets.top + 16, right: 16, backgroundColor: "rgba(0,0,0,0.55)", borderRadius: 22, padding: 10 }}
          >
            <Feather name="x" size={22} color="#fff" />
          </TouchableOpacity>
          <View style={{ position: "absolute", bottom: bottomPad + 48, left: 20, right: 20, alignItems: "center" }}>
            <View style={{ backgroundColor: "rgba(0,0,0,0.6)", borderRadius: 10, paddingHorizontal: 18, paddingVertical: 10 }}>
              <Text style={{ color: "#fff", fontSize: 13, fontFamily: "Inter_500Medium", textAlign: "center" }}>
                Point at the input item barcode label
              </Text>
            </View>
          </View>
          {/* Scan finder frame */}
          <View style={{ position: "absolute", top: 0, left: 0, right: 0, bottom: 0, alignItems: "center", justifyContent: "center", pointerEvents: "none" }}>
            <View style={{ width: 260, height: 100, borderWidth: 2, borderColor: "rgba(255,255,255,0.7)", borderRadius: 8 }} />
          </View>
        </View>
      );
    }

    return (
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === "ios" ? "padding" : undefined}>
        <ScrollView
          style={[styles.root, { backgroundColor: colors.background }]}
          contentContainerStyle={[styles.content, { paddingBottom: bottomPad + 32 }]}
          keyboardShouldPersistTaps="handled"
        >
          <StepIndicator />

          <TouchableOpacity
            style={[styles.backBtn, { borderColor: colors.border, borderRadius: colors.radius }]}
            onPress={() => setStep("details")}
          >
            <Feather name="arrow-left" size={16} color={colors.mutedForeground} />
            <Text style={[styles.backBtnText, { color: colors.mutedForeground }]}>Back</Text>
          </TouchableOpacity>

          {/* Instruction */}
          <View style={[styles.section, { backgroundColor: colors.card, borderColor: colors.border, borderRadius: colors.radius }]}>
            <View style={{ flexDirection: "row", alignItems: "center", gap: 10 }}>
              <View style={{ width: 40, height: 40, borderRadius: 20, backgroundColor: colors.primary + "18", alignItems: "center", justifyContent: "center" }}>
                <Feather name="package" size={20} color={colors.primary} />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={[{ fontSize: 15, fontFamily: "Inter_600SemiBold", color: colors.foreground }]}>Scan Input Barcode</Text>
                <Text style={[{ fontSize: 13, fontFamily: "Inter_400Regular", color: colors.mutedForeground, marginTop: 2 }]}>
                  Scan or enter the barcode from the input item label to confirm what is being delivered.
                </Text>
              </View>
            </View>
          </View>

          {/* Barcode entry */}
          <View style={[styles.section, { backgroundColor: colors.card, borderColor: colors.border, borderRadius: colors.radius }]}>
            <Text style={[styles.sectionLabel, { color: colors.mutedForeground }]}>Input Barcode</Text>
            <View style={{ flexDirection: "row", gap: 8 }}>
              <TextInput
                style={[{
                  flex: 1, height: 46, borderWidth: 1, borderColor: colors.border,
                  borderRadius: colors.radius, paddingHorizontal: 12,
                  fontSize: 14, fontFamily: "Inter_400Regular", color: colors.foreground,
                  backgroundColor: colors.muted,
                }]}
                value={scannedBarcode}
                onChangeText={(v) => { setScannedBarcode(v); setScanError(null); setScannedItem(null); }}
                placeholder="e.g. SEED-A3X7K2"
                placeholderTextColor={colors.mutedForeground}
                autoCapitalize="characters"
                autoCorrect={false}
              />
              {Platform.OS !== "web" && CameraView && (
                <TouchableOpacity
                  style={[{
                    width: 46, height: 46, borderWidth: 1, borderColor: colors.border,
                    borderRadius: colors.radius, alignItems: "center", justifyContent: "center",
                    backgroundColor: colors.muted,
                  }]}
                  onPress={async () => {
                    try {
                      const cam = require("expo-camera");
                      const { status } = await cam.Camera.requestCameraPermissionsAsync();
                      if (status === "granted") setCameraOpen(true);
                      else Alert.alert("Permission Required", "Camera access is needed to scan barcodes.");
                    } catch {
                      Alert.alert("Camera unavailable", "Use manual entry instead.");
                    }
                  }}
                >
                  <Feather name="camera" size={20} color={colors.primary} />
                </TouchableOpacity>
              )}
            </View>

            {/* Verify button */}
            <TouchableOpacity
              style={[styles.submitBtn, {
                backgroundColor: !scannedBarcode.trim() || scanLoading ? colors.muted : colors.primary,
                borderRadius: colors.radius, marginTop: 4,
              }]}
              onPress={() => handleVerifyBarcode(scannedBarcode)}
              disabled={!scannedBarcode.trim() || scanLoading}
              activeOpacity={0.85}
            >
              {scanLoading
                ? <ActivityIndicator color={colors.primary} />
                : <>
                    <Feather name="check-circle" size={17} color={!scannedBarcode.trim() ? colors.mutedForeground : "#fff"} />
                    <Text style={[styles.submitBtnText, { color: !scannedBarcode.trim() ? colors.mutedForeground : "#fff" }]}>
                      Verify Input
                    </Text>
                  </>
              }
            </TouchableOpacity>
          </View>

          {/* Verified result card */}
          {scannedItem && (
            <View style={[styles.section, { backgroundColor: colors.success + "12", borderColor: colors.success + "50", borderRadius: colors.radius }]}>
              <View style={{ flexDirection: "row", alignItems: "center", gap: 10 }}>
                <Feather name="check-circle" size={22} color={colors.success} />
                <View style={{ flex: 1 }}>
                  <Text style={{ fontSize: 15, fontFamily: "Inter_600SemiBold", color: colors.success }}>{scannedItem.name}</Text>
                  <Text style={{ fontSize: 12, fontFamily: "Inter_400Regular", color: colors.mutedForeground, marginTop: 2 }}>
                    {[scannedItem.category, scannedItem.unit].filter(Boolean).join(" · ")}
                    {" · "}<Text style={{ fontFamily: "Inter_500Medium" }}>{scannedBarcode}</Text>
                  </Text>
                </View>
              </View>
              <TouchableOpacity
                style={[styles.submitBtn, { backgroundColor: colors.primary, borderRadius: colors.radius, marginTop: 4 }]}
                onPress={proceedToOtp}
                disabled={sendingOtp}
                activeOpacity={0.85}
              >
                {sendingOtp
                  ? <ActivityIndicator color="#fff" />
                  : <>
                      <Feather name="shield" size={17} color="#fff" />
                      <Text style={styles.submitBtnText}>Continue to Verification</Text>
                    </>
                }
              </TouchableOpacity>
            </View>
          )}

          {/* Not found warning */}
          {scanError && !scannedItem && (
            <View style={[styles.section, { backgroundColor: colors.warning + "12", borderColor: colors.warning + "50", borderRadius: colors.radius }]}>
              <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
                <Feather name="alert-triangle" size={18} color={colors.warning} />
                <Text style={{ fontSize: 14, fontFamily: "Inter_600SemiBold", color: colors.warning }}>Item Not Found</Text>
              </View>
              <Text style={{ fontSize: 13, fontFamily: "Inter_400Regular", color: colors.mutedForeground, lineHeight: 18 }}>
                No input item matched <Text style={{ fontFamily: "Inter_600SemiBold" }}>{scannedBarcode}</Text>. You can continue without input verification — the record will note the barcode was not matched.
              </Text>
              <TouchableOpacity
                style={[styles.submitBtn, { backgroundColor: colors.warning, borderRadius: colors.radius, marginTop: 4 }]}
                onPress={proceedToOtp}
                disabled={sendingOtp}
                activeOpacity={0.85}
              >
                {sendingOtp
                  ? <ActivityIndicator color="#fff" />
                  : <>
                      <Feather name="arrow-right" size={17} color="#fff" />
                      <Text style={styles.submitBtnText}>Continue Anyway</Text>
                    </>
                }
              </TouchableOpacity>
            </View>
          )}

          {/* Skip link */}
          {!scannedItem && !scanError && (
            <TouchableOpacity
              style={{ alignItems: "center", paddingVertical: 12 }}
              onPress={handleSkipScan}
              disabled={sendingOtp}
            >
              <Text style={{ fontSize: 13, fontFamily: "Inter_500Medium", color: colors.mutedForeground }}>
                Skip scan — proceed without input verification
              </Text>
            </TouchableOpacity>
          )}

          {dispatchId && (
            <View style={[styles.dispatchBadge, { backgroundColor: colors.muted, borderRadius: colors.radius }]}>
              <Feather name="truck" size={14} color={colors.mutedForeground} />
              <Text style={[styles.dispatchText, { color: colors.mutedForeground }]}>Dispatch #{dispatchId}</Text>
            </View>
          )}
        </ScrollView>
      </KeyboardAvoidingView>
    );
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // STEP 3 — OTP
  // ═══════════════════════════════════════════════════════════════════════════
  if (step === "otp") {
    return (
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === "ios" ? "padding" : undefined}>
        <ScrollView
          style={[styles.root, { backgroundColor: colors.background }]}
          contentContainerStyle={[styles.content, { paddingBottom: bottomPad + 32 }]}
          keyboardShouldPersistTaps="handled"
        >
          <StepIndicator />
          <TouchableOpacity
            style={[styles.backBtn, { borderColor: colors.border, borderRadius: colors.radius }]}
            onPress={() => { setStep("scan"); setOtpError(null); }}
          >
            <Feather name="arrow-left" size={16} color={colors.mutedForeground} />
            <Text style={[styles.backBtnText, { color: colors.mutedForeground }]}>Back</Text>
          </TouchableOpacity>

          {devCode && (
            <View style={[styles.devBanner, { backgroundColor: "#fef3c7", borderColor: "#f59e0b", borderRadius: colors.radius }]}>
              <Feather name="terminal" size={16} color="#92400e" />
              <View style={{ flex: 1 }}>
                <Text style={styles.devBannerLabel}>
                  Dev Mode —{" "}
                  {otpResult?.channel === "sms+whatsapp" ? "SMS & WhatsApp sent"
                    : otpResult?.channel === "whatsapp" ? "WhatsApp sent"
                    : otpResult?.channel === "sms" ? "SMS sent"
                    : "Not delivered to handset"}
                </Text>
                <Text style={styles.devBannerCode}>{devCode}</Text>
              </View>
            </View>
          )}

          <View style={[styles.otpCard, { backgroundColor: colors.card, borderColor: colors.primary + "40", borderRadius: colors.radius }]}>
            <View style={[styles.otpIconWrap, { backgroundColor: colors.primary + "12" }]}>
              <Feather name="shield" size={32} color={colors.primary} />
            </View>
            <Text style={[styles.otpTitle, { color: colors.foreground }]}>Delivery Code Verification</Text>
            <Text style={[styles.otpSubtitle, { color: colors.mutedForeground }]}>
              Ask the farmer to show you the 6-digit code they received via SMS or WhatsApp when this dispatch was notified.
            </Text>
            {otpResult && (
              <View style={{ alignItems: "center", gap: 4, marginTop: 6 }}>
                <Text style={{ fontSize: 12, fontFamily: "Inter_400Regular", color: colors.mutedForeground }}>
                  Code sent to{" "}
                  <Text style={{ fontFamily: "Inter_600SemiBold", color: colors.foreground }}>{otpResult.maskedPhone}</Text>
                </Text>
                <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
                  {(otpResult.channel === "sms+whatsapp" || otpResult.channel === "whatsapp") && (
                    <View style={{ flexDirection: "row", alignItems: "center", gap: 3, backgroundColor: "#25d36620", borderRadius: 8, paddingHorizontal: 8, paddingVertical: 3 }}>
                      <Feather name="message-circle" size={11} color="#25d366" />
                      <Text style={{ fontSize: 10, fontFamily: "Inter_600SemiBold", color: "#25d366" }}>WhatsApp</Text>
                    </View>
                  )}
                  {(otpResult.channel === "sms+whatsapp" || otpResult.channel === "sms") && (
                    <View style={{ flexDirection: "row", alignItems: "center", gap: 3, backgroundColor: colors.primary + "18", borderRadius: 8, paddingHorizontal: 8, paddingVertical: 3 }}>
                      <Feather name="message-square" size={11} color={colors.primary} />
                      <Text style={{ fontSize: 10, fontFamily: "Inter_600SemiBold", color: colors.primary }}>SMS</Text>
                    </View>
                  )}
                </View>
              </View>
            )}
            <View style={styles.digitRow}>
              {digits.map((d, i) => (
                <TextInput
                  key={i}
                  ref={(r) => { inputRefs.current[i] = r; }}
                  style={[styles.digitBox, {
                    borderColor: otpError ? colors.destructive : d ? colors.primary : colors.border,
                    color: colors.foreground,
                    backgroundColor: colors.muted,
                    borderRadius: colors.radius,
                  }]}
                  value={d}
                  onChangeText={(t) => handleDigitChange(t, i)}
                  onKeyPress={({ nativeEvent }) => handleDigitKeyPress(nativeEvent.key, i)}
                  keyboardType="number-pad"
                  maxLength={1}
                  textAlign="center"
                  selectTextOnFocus
                />
              ))}
            </View>
            {otpError && (
              <View style={styles.errorRow}>
                <Feather name="alert-circle" size={14} color={colors.destructive} />
                <Text style={[styles.errorText, { color: colors.destructive }]}>{otpError}</Text>
              </View>
            )}
            <View style={styles.resendRow}>
              <Text style={[styles.resendLabel, { color: colors.mutedForeground }]}>Farmer doesn't have a code?</Text>
              {resendTimer > 0 ? (
                <Text style={[styles.resendTimer, { color: colors.mutedForeground }]}>Resend in {resendTimer}s</Text>
              ) : (
                <TouchableOpacity onPress={handleResend} disabled={sendingOtp}>
                  <Text style={[styles.resendLink, { color: colors.primary }]}>
                    {sendingOtp ? "Sending…" : otpResult ? "Resend code" : "Send code to farmer"}
                  </Text>
                </TouchableOpacity>
              )}
            </View>
          </View>

          <View style={[styles.summaryCard, { backgroundColor: colors.muted, borderRadius: colors.radius }]}>
            <View style={styles.summaryRow}>
              <Feather name="user" size={14} color={colors.mutedForeground} />
              <Text style={[styles.summaryText, { color: colors.mutedForeground }]}>{farmerName} · {farmerCode}</Text>
            </View>
            <View style={styles.summaryRow}>
              <Feather name="package" size={14} color={colors.mutedForeground} />
              <Text style={[styles.summaryText, { color: colors.mutedForeground }]}>{quantity} unit{Number(quantity) !== 1 ? "s" : ""} to be issued</Text>
            </View>
            {gps && (
              <View style={styles.summaryRow}>
                <Feather name="map-pin" size={14} color={colors.mutedForeground} />
                <Text style={[styles.summaryText, { color: colors.mutedForeground }]}>
                  {gps.latitude.toFixed(4)}, {gps.longitude.toFixed(4)}
                </Text>
              </View>
            )}
          </View>

          {(smsDeliveryFailed || !otpEnabled) && (
            <View style={[styles.skipBanner, { backgroundColor: colors.warning + "18", borderColor: colors.warning + "50", borderRadius: colors.radius }]}>
              <Feather name="alert-triangle" size={15} color={colors.warning} />
              <Text style={[styles.skipBannerText, { color: colors.warning }]}>
                {smsDeliveryFailed
                  ? "SMS could not be delivered — no coverage at this location."
                  : "OTP verification is currently disabled by your administrator."}
              </Text>
            </View>
          )}

          <View style={[styles.actions, { flexWrap: "wrap" }]}>
            <TouchableOpacity
              style={[styles.offlineBtn, { borderColor: colors.border, borderRadius: colors.radius }]}
              onPress={() => doSubmit("Bypassed", "Bypassed", true)}
              disabled={verifying || submitting}
              activeOpacity={0.8}
            >
              <Feather name="wifi-off" size={16} color={colors.mutedForeground} />
              <Text style={[styles.offlineBtnText, { color: colors.mutedForeground }]}>Save Offline</Text>
            </TouchableOpacity>
            {(smsDeliveryFailed || !otpEnabled) && (
              <TouchableOpacity
                style={[styles.skipOtpBtn, { borderColor: colors.warning + "80", borderRadius: colors.radius }]}
                onPress={handleSkipOtp}
                disabled={verifying || submitting}
                activeOpacity={0.8}
              >
                <Feather name="skip-forward" size={16} color={colors.warning} />
                <Text style={[styles.offlineBtnText, { color: colors.warning }]}>Skip OTP</Text>
              </TouchableOpacity>
            )}
            <TouchableOpacity
              style={[styles.submitBtn, { backgroundColor: colors.primary, borderRadius: colors.radius, opacity: (verifying || submitting) ? 0.7 : 1 }]}
              onPress={() => handleVerify()}
              disabled={verifying || submitting}
              activeOpacity={0.85}
            >
              {(verifying || submitting) ? <ActivityIndicator color="#fff" /> : (
                <>
                  <Feather name="check-circle" size={18} color="#fff" />
                  <Text style={styles.submitBtnText}>Confirm Code</Text>
                </>
              )}
            </TouchableOpacity>
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    );
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // STEP "photos" — Delivery Photo Capture
  // ═══════════════════════════════════════════════════════════════════════════
  if (step === "photos") {
    const uploadedCount = deliveryPhotos.filter(p => p.key).length;
    const requiredUploaded = REQUIRED_PHOTO_INDICES.every(i => !!deliveryPhotos[i]?.key);
    const allUploaded = uploadedCount === PHOTO_SLOTS.length;
    const anyUploading = deliveryPhotos.some(p => p.uploading);

    return (
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === "ios" ? "padding" : undefined}>
        <ScrollView
          style={[styles.root, { backgroundColor: colors.background }]}
          contentContainerStyle={[styles.content, { paddingBottom: bottomPad + 32 }]}
          keyboardShouldPersistTaps="handled"
        >
          <StepIndicator />

          <TouchableOpacity
            style={[styles.backBtn, { borderColor: colors.border, borderRadius: colors.radius }]}
            onPress={() => setStep(otpBypassed ? "scan" : "otp")}
          >
            <Feather name="arrow-left" size={16} color={colors.mutedForeground} />
            <Text style={[styles.backBtnText, { color: colors.mutedForeground }]}>Back</Text>
          </TouchableOpacity>

          {/* Header card */}
          <View style={[styles.section, { backgroundColor: colors.card, borderColor: colors.border, borderRadius: colors.radius }]}>
            <View style={{ flexDirection: "row", alignItems: "center", gap: 10 }}>
              <View style={{ width: 40, height: 40, borderRadius: 20, backgroundColor: colors.primary + "18", alignItems: "center", justifyContent: "center" }}>
                <Feather name="image" size={20} color={colors.primary} />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={{ fontSize: 15, fontFamily: "Inter_600SemiBold", color: colors.foreground }}>Delivery Photos</Text>
                <Text style={{ fontSize: 13, fontFamily: "Inter_400Regular", color: colors.mutedForeground, marginTop: 2 }}>
                  Capture photos documenting this delivery. Photos marked <Text style={{ fontFamily: "Inter_600SemiBold", color: colors.destructive }}>Required</Text> must be taken before continuing.
                </Text>
              </View>
            </View>
            {/* Progress bar */}
            <View style={{ marginTop: 12, gap: 6 }}>
              <View style={{ flexDirection: "row", justifyContent: "space-between" }}>
                <Text style={{ fontSize: 12, fontFamily: "Inter_500Medium", color: colors.mutedForeground }}>
                  {uploadedCount} of {PHOTO_SLOTS.length} photos captured
                  {" · "}{REQUIRED_PHOTO_INDICES.filter(i => deliveryPhotos[i]?.key).length}/{REQUIRED_PHOTO_INDICES.length} required
                </Text>
                {requiredUploaded && (
                  <Text style={{ fontSize: 12, fontFamily: "Inter_600SemiBold", color: colors.success }}>✓ Ready</Text>
                )}
              </View>
              <View style={{ height: 5, borderRadius: 3, backgroundColor: colors.border, overflow: "hidden" }}>
                <View style={{
                  width: `${(uploadedCount / PHOTO_SLOTS.length) * 100}%` as any,
                  height: "100%",
                  backgroundColor: requiredUploaded ? colors.success : colors.primary,
                  borderRadius: 3,
                }} />
              </View>
            </View>
          </View>

          {/* GPS status */}
          {gps ? (
            <View style={[styles.summaryCard, { backgroundColor: colors.success + "10", borderRadius: colors.radius, borderWidth: 1, borderColor: colors.success + "40" }]}>
              <View style={styles.summaryRow}>
                <Feather name="map-pin" size={14} color={colors.success} />
                <Text style={[styles.summaryText, { color: colors.success }]}>
                  GPS captured: {gps.latitude.toFixed(5)}, {gps.longitude.toFixed(5)}
                  {gps.accuracy != null ? `  ±${Math.round(gps.accuracy)}m` : ""}
                </Text>
              </View>
            </View>
          ) : (
            <View style={[styles.summaryCard, { backgroundColor: colors.warning + "12", borderRadius: colors.radius, borderWidth: 1, borderColor: colors.warning + "40" }]}>
              <View style={styles.summaryRow}>
                <Feather name="wifi-off" size={14} color={colors.warning} />
                <Text style={[styles.summaryText, { color: colors.warning }]}>No GPS signal — delivery will be recorded without coordinates</Text>
                <TouchableOpacity onPress={captureGPS} disabled={gpsLoading}>
                  <Text style={{ fontSize: 12, fontFamily: "Inter_600SemiBold", color: colors.primary }}>
                    {gpsLoading ? "…" : "Retry"}
                  </Text>
                </TouchableOpacity>
              </View>
            </View>
          )}

          {/* 2-column photo grid */}
          <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 10 }}>
            {deliveryPhotos.map((photo, index) => {
              const isRequired = REQUIRED_PHOTO_INDICES.includes(index);
              return (
                <View
                  key={index}
                  style={{
                    width: "47.5%",
                    borderRadius: colors.radius,
                    borderWidth: 1.5,
                    borderColor: photo.key ? colors.success + "80" : photo.error ? colors.destructive + "60" : isRequired ? colors.destructive + "40" : colors.border,
                    backgroundColor: colors.card,
                    overflow: "hidden",
                  }}
                >
                  {/* Thumbnail or placeholder */}
                  {photo.uri ? (
                    <View style={{ position: "relative" }}>
                      <Image source={{ uri: photo.uri }} style={{ width: "100%", height: 120 }} resizeMode="cover" />
                      {photo.key && (
                        <View style={{ position: "absolute", top: 6, right: 6, backgroundColor: colors.success, borderRadius: 12, padding: 4 }}>
                          <Feather name="check" size={12} color="#fff" />
                        </View>
                      )}
                      {photo.key && photo.gps && (
                        <View style={{ position: "absolute", bottom: 6, left: 6, flexDirection: "row", alignItems: "center", gap: 3, backgroundColor: "rgba(0,0,0,0.55)", borderRadius: 8, paddingHorizontal: 5, paddingVertical: 2 }}>
                          <Feather name="map-pin" size={9} color="#4ade80" />
                          <Text style={{ color: "#4ade80", fontSize: 8, fontFamily: "Inter_600SemiBold" }}>GPS</Text>
                        </View>
                      )}
                      {photo.key && !photo.gps && (
                        <View style={{ position: "absolute", bottom: 6, left: 6, flexDirection: "row", alignItems: "center", gap: 3, backgroundColor: "rgba(0,0,0,0.55)", borderRadius: 8, paddingHorizontal: 5, paddingVertical: 2 }}>
                          <Feather name="map-pin" size={9} color="#fbbf24" />
                          <Text style={{ color: "#fbbf24", fontSize: 8, fontFamily: "Inter_600SemiBold" }}>No GPS</Text>
                        </View>
                      )}
                      {photo.uploading && (
                        <View style={{ position: "absolute", top: 0, left: 0, right: 0, bottom: 0, backgroundColor: "rgba(0,0,0,0.45)", alignItems: "center", justifyContent: "center" }}>
                          <ActivityIndicator color="#fff" size="small" />
                          <Text style={{ color: "#fff", fontSize: 11, fontFamily: "Inter_500Medium", marginTop: 4 }}>Uploading…</Text>
                        </View>
                      )}
                    </View>
                  ) : (
                    <View style={{ height: 120, alignItems: "center", justifyContent: "center", backgroundColor: colors.muted }}>
                      <Feather name="image" size={28} color={isRequired ? colors.destructive + "80" : colors.mutedForeground} />
                    </View>
                  )}

                  {/* Label + badge + button */}
                  <View style={{ padding: 8, gap: 6 }}>
                    <View style={{ flexDirection: "row", alignItems: "center", gap: 5 }}>
                      <Text style={{ fontSize: 11, fontFamily: "Inter_600SemiBold", color: colors.foreground, flex: 1 }} numberOfLines={1}>
                        {index + 1}. {photo.label}
                      </Text>
                      <View style={{
                        paddingHorizontal: 5,
                        paddingVertical: 2,
                        borderRadius: 4,
                        backgroundColor: isRequired ? colors.destructive + "18" : colors.muted,
                      }}>
                        <Text style={{ fontSize: 9, fontFamily: "Inter_600SemiBold", color: isRequired ? colors.destructive : colors.mutedForeground }}>
                          {isRequired ? "Required" : "Optional"}
                        </Text>
                      </View>
                    </View>
                    {photo.error && (
                      <Text style={{ fontSize: 10, fontFamily: "Inter_400Regular", color: colors.destructive }} numberOfLines={2}>
                        {photo.error}
                      </Text>
                    )}
                    <TouchableOpacity
                      style={{
                        flexDirection: "row",
                        alignItems: "center",
                        justifyContent: "center",
                        gap: 4,
                        paddingVertical: 7,
                        borderRadius: colors.radius,
                        backgroundColor: photo.key ? colors.success + "14" : colors.primary + "14",
                        borderWidth: 1,
                        borderColor: photo.key ? colors.success + "80" : colors.primary + "80",
                      }}
                      onPress={() => handleTakeDeliveryPhoto(index)}
                      disabled={photo.uploading}
                      activeOpacity={0.8}
                    >
                      <Feather name="camera" size={13} color={photo.key ? colors.success : colors.primary} />
                      <Text style={{ fontSize: 12, fontFamily: "Inter_600SemiBold", color: photo.key ? colors.success : colors.primary }}>
                        {photo.key ? "Retake" : photo.error ? "Retry" : "Take Photo"}
                      </Text>
                    </TouchableOpacity>
                  </View>
                </View>
              );
            })}
          </View>

          {/* Summary */}
          <View style={[styles.summaryCard, { backgroundColor: colors.muted, borderRadius: colors.radius }]}>
            <View style={styles.summaryRow}>
              <Feather name="user" size={14} color={colors.mutedForeground} />
              <Text style={[styles.summaryText, { color: colors.mutedForeground }]}>{farmerName} · {farmerCode}</Text>
            </View>
            <View style={styles.summaryRow}>
              <Feather name="package" size={14} color={colors.mutedForeground} />
              <Text style={[styles.summaryText, { color: colors.mutedForeground }]}>{quantity} unit{Number(quantity) !== 1 ? "s" : ""} to be issued</Text>
            </View>
          </View>

          {/* Actions */}
          <View style={styles.actions}>
            <TouchableOpacity
              style={[styles.offlineBtn, { borderColor: colors.border, borderRadius: colors.radius }]}
              onPress={() => doSubmit(otpBypassed ? "SMSBypass" : "Verified", "Bypassed", true)}
              disabled={anyUploading || submitting}
              activeOpacity={0.8}
            >
              <Feather name="wifi-off" size={16} color={colors.mutedForeground} />
              <Text style={[styles.offlineBtnText, { color: colors.mutedForeground }]}>Save Offline</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.submitBtn, {
                backgroundColor: requiredUploaded ? colors.primary : colors.muted,
                borderRadius: colors.radius,
                opacity: (anyUploading || submitting) ? 0.7 : 1,
              }]}
              onPress={() => { setFacePhotoUri(null); setFaceResult(null); setFaceError(null); setStep("face"); }}
              disabled={!requiredUploaded || anyUploading}
              activeOpacity={0.85}
            >
              <Feather name="camera" size={18} color={requiredUploaded ? "#fff" : colors.mutedForeground} />
              <Text style={[styles.submitBtnText, { color: requiredUploaded ? "#fff" : colors.mutedForeground }]}>
                {allUploaded ? "Next: Face ID" : `Next: Face ID (${PHOTO_SLOTS.length - uploadedCount} optional left)`}
              </Text>
            </TouchableOpacity>
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    );
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // STEP 3 — Face Verification
  // ═══════════════════════════════════════════════════════════════════════════
  const faceVerified = faceResult?.faceStatus === "Verified";
  const faceNoReference = faceResult?.faceStatus === "NoReference";
  const faceFailed = faceResult && !faceVerified && !faceNoReference;

  return (
    <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === "ios" ? "padding" : undefined}>
      <ScrollView
        style={[styles.root, { backgroundColor: colors.background }]}
        contentContainerStyle={[styles.content, { paddingBottom: bottomPad + 32 }]}
        keyboardShouldPersistTaps="handled"
      >
        <StepIndicator />
        <TouchableOpacity
          style={[styles.backBtn, { borderColor: colors.border, borderRadius: colors.radius }]}
          onPress={() => { setStep("photos"); setFacePhotoUri(null); setFaceResult(null); setFaceError(null); }}
        >
          <Feather name="arrow-left" size={16} color={colors.mutedForeground} />
          <Text style={[styles.backBtnText, { color: colors.mutedForeground }]}>Back</Text>
        </TouchableOpacity>

        <View style={[
          styles.faceCard,
          {
            backgroundColor: colors.card,
            borderRadius: colors.radius,
            borderColor: faceVerified ? colors.success + "80"
              : faceNoReference ? colors.warning + "80"
              : faceFailed ? colors.destructive + "60"
              : colors.primary + "40",
          },
        ]}>
          <View style={[styles.otpIconWrap, {
            backgroundColor: faceVerified ? colors.success + "18"
              : faceNoReference ? colors.warning + "18"
              : faceFailed ? colors.destructive + "12"
              : colors.primary + "12",
          }]}>
            <Feather
              name={faceVerified ? "check-circle" : faceFailed ? "alert-triangle" : "camera"}
              size={32}
              color={faceVerified ? colors.success : faceNoReference ? colors.warning : faceFailed ? colors.destructive : colors.primary}
            />
          </View>

          <Text style={[styles.otpTitle, { color: colors.foreground }]}>Face Verification</Text>
          <Text style={[styles.otpSubtitle, { color: colors.mutedForeground }]}>
            {faceVerified
              ? "Identity confirmed successfully"
              : faceNoReference
              ? "No reference photo on file — photo saved for future use"
              : faceResult?.faceStatus === "NoFace"
              ? "No face detected — please retake the photo"
              : faceFailed
              ? "Face did not match the reference photo"
              : "Take a clear photo of the farmer's face for identity check"}
          </Text>

          {/* Similarity gauge — shown after a comparison is made */}
          {faceResult?.similarity != null && (
            <View style={{ width: "100%", marginTop: 10, gap: 5 }}>
              <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center" }}>
                <Text style={{ fontSize: 11, fontFamily: "Inter_500Medium", color: colors.mutedForeground }}>
                  Similarity score
                </Text>
                <Text style={{
                  fontSize: 13, fontFamily: "Inter_700Bold",
                  color: faceVerified ? colors.success : faceResult.similarity >= 50 ? colors.warning : colors.destructive,
                }}>
                  {faceResult.similarity}%
                </Text>
              </View>
              <View style={{ height: 7, borderRadius: 4, backgroundColor: colors.border, overflow: "hidden" }}>
                <View style={{
                  width: `${Math.min(100, faceResult.similarity)}%` as any,
                  height: "100%",
                  borderRadius: 4,
                  backgroundColor: faceVerified ? colors.success : faceResult.similarity >= 50 ? colors.warning : colors.destructive,
                }} />
              </View>
              <Text style={{ fontSize: 10, fontFamily: "Inter_400Regular", color: colors.mutedForeground, textAlign: "center" }}>
                {faceVerified
                  ? "✓ Match confirmed — above 80% threshold"
                  : faceResult.similarity >= 50
                  ? "Below match threshold (need ≥ 80%)"
                  : "Poor match — likely different person"}
              </Text>
            </View>
          )}

          {facePhotoUri ? (
            <View style={styles.photoWrap}>
              <Image source={{ uri: facePhotoUri }} style={styles.photoPreview} resizeMode="cover" />
              {faceVerified && (
                <View style={[styles.photoBadge, { backgroundColor: colors.success }]}>
                  <Feather name="check" size={14} color="#fff" />
                  <Text style={styles.photoBadgeText}>
                    {faceResult?.similarity != null ? `${faceResult.similarity}% match` : "Verified"}
                  </Text>
                </View>
              )}
              {faceNoReference && (
                <View style={[styles.photoBadge, { backgroundColor: colors.warning }]}>
                  <Feather name="save" size={14} color="#fff" />
                  <Text style={styles.photoBadgeText}>Saved as reference</Text>
                </View>
              )}
              {faceFailed && (
                <View style={[styles.photoBadge, { backgroundColor: colors.destructive }]}>
                  <Feather name="x" size={14} color="#fff" />
                  <Text style={styles.photoBadgeText}>
                    {faceResult?.similarity != null ? `${faceResult.similarity}% — No match` : "Not matched"}
                  </Text>
                </View>
              )}
            </View>
          ) : (
            <View style={[styles.cameraPlaceholder, { backgroundColor: colors.muted, borderColor: colors.border }]}>
              <Feather name="camera" size={40} color={colors.mutedForeground} />
              <Text style={[styles.cameraPlaceholderText, { color: colors.mutedForeground }]}>No photo taken yet</Text>
            </View>
          )}

          {faceLoading && (
            <View style={styles.faceLoadingRow}>
              <ActivityIndicator color={colors.primary} size="small" />
              <Text style={[styles.faceLoadingText, { color: colors.mutedForeground }]}>Analysing with AWS Rekognition…</Text>
            </View>
          )}

          {faceError && (
            <View style={styles.errorRow}>
              <Feather name="alert-circle" size={14} color={colors.destructive} />
              <Text style={[styles.errorText, { color: colors.destructive }]}>{faceError}</Text>
            </View>
          )}

          <TouchableOpacity
            style={[styles.cameraBtn, { backgroundColor: colors.primary + "14", borderColor: colors.primary, borderRadius: colors.radius }]}
            onPress={handleTakePhoto}
            disabled={faceLoading || submitting}
            activeOpacity={0.8}
          >
            <Feather name="camera" size={18} color={colors.primary} />
            <Text style={[styles.cameraBtnText, { color: colors.primary }]}>
              {facePhotoUri ? "Retake Photo" : "Open Camera"}
            </Text>
          </TouchableOpacity>
        </View>

        <View style={[styles.summaryCard, { backgroundColor: colors.muted, borderRadius: colors.radius }]}>
          <View style={styles.summaryRow}>
            <Feather name="user" size={14} color={colors.mutedForeground} />
            <Text style={[styles.summaryText, { color: colors.mutedForeground }]}>{farmerName} · {farmerCode}</Text>
          </View>
          <View style={styles.summaryRow}>
            <Feather name="package" size={14} color={colors.mutedForeground} />
            <Text style={[styles.summaryText, { color: colors.mutedForeground }]}>{quantity} unit{Number(quantity) !== 1 ? "s" : ""} to be issued</Text>
          </View>
          <View style={styles.summaryRow}>
            <Feather name="shield" size={14} color={otpBypassed ? colors.warning : colors.success} />
            <Text style={[styles.summaryText, { color: otpBypassed ? colors.warning : colors.success }]}>
              {otpBypassed ? "OTP skipped — flagged for review" : "OTP verified"}
            </Text>
          </View>
        </View>

        <View style={styles.actions}>
          {faceFailed && (
            <TouchableOpacity
              style={[styles.overrideBtn, { borderColor: colors.destructive + "80", borderRadius: colors.radius }]}
              onPress={handleFaceOverride}
              disabled={submitting}
              activeOpacity={0.8}
            >
              <Feather name="alert-triangle" size={16} color={colors.destructive} />
              <Text style={[styles.offlineBtnText, { color: colors.destructive }]}>Override</Text>
            </TouchableOpacity>
          )}
          {!facePhotoUri && !faceLoading && (
            <TouchableOpacity
              style={[styles.offlineBtn, { borderColor: colors.border, borderRadius: colors.radius }]}
              onPress={() => doSubmit(otpBypassed ? "SMSBypass" : "Verified", "Bypassed")}
              disabled={submitting}
              activeOpacity={0.8}
            >
              <Feather name="skip-forward" size={16} color={colors.mutedForeground} />
              <Text style={[styles.offlineBtnText, { color: colors.mutedForeground }]}>Skip</Text>
            </TouchableOpacity>
          )}
          {(faceVerified || faceNoReference) && (
            <TouchableOpacity
              style={[styles.submitBtn, { backgroundColor: colors.success, borderRadius: colors.radius, opacity: submitting ? 0.7 : 1 }]}
              onPress={() => doSubmit(otpBypassed ? "SMSBypass" : "Verified", faceResult?.faceStatus ?? "Verified")}
              disabled={submitting}
              activeOpacity={0.85}
            >
              {submitting ? <ActivityIndicator color="#fff" /> : (
                <>
                  <Feather name="check-circle" size={18} color="#fff" />
                  <Text style={styles.submitBtnText}>Submit PoD</Text>
                </>
              )}
            </TouchableOpacity>
          )}
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const resultStyles = StyleSheet.create({
  successRing: { width: 120, height: 120, borderRadius: 60, alignItems: "center", justifyContent: "center", borderWidth: 2, marginTop: 24, marginBottom: 8 },
  successInner: { width: 90, height: 90, borderRadius: 45, alignItems: "center", justifyContent: "center" },
  successTitle: { fontSize: 24, fontFamily: "Inter_700Bold", marginTop: 12 },
  podCode: { fontSize: 15, fontFamily: "Inter_600SemiBold", marginTop: 4, letterSpacing: 1 },
  farmerLabel: { fontSize: 13, fontFamily: "Inter_400Regular", marginTop: 4 },
  contactLabel: { fontSize: 12, fontFamily: "Inter_400Regular", marginTop: 2, marginBottom: 20 },
  gpsCard: { padding: 20, borderWidth: 1.5, alignItems: "center", gap: 8, marginBottom: 12 },
  gpsIconWrap: { width: 56, height: 56, borderRadius: 28, alignItems: "center", justifyContent: "center", marginBottom: 4 },
  gpsTitle: { fontSize: 16, fontFamily: "Inter_700Bold", textAlign: "center" },
  gpsDesc: { fontSize: 13, fontFamily: "Inter_400Regular", textAlign: "center", lineHeight: 20 },
  gpsCoords: { fontSize: 11, fontFamily: "Inter_400Regular", marginTop: 4 },
  summaryCard: { padding: 14, gap: 10, marginBottom: 20 },
  summaryRow: { flexDirection: "row", alignItems: "center", gap: 10 },
  summaryLabel: { fontSize: 13, fontFamily: "Inter_500Medium", width: 56 },
  summaryVal: { fontSize: 13, fontFamily: "Inter_600SemiBold", flex: 1 },
  doneBtn: { height: 52, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 10 },
  doneBtnText: { color: "#fff", fontFamily: "Inter_700Bold", fontSize: 16 },
});

const styles = StyleSheet.create({
  root: { flex: 1 },
  content: { padding: 16, gap: 12 },
  stepBar: { flexDirection: "row", alignItems: "center", justifyContent: "center", paddingVertical: 8 },
  stepItem: { alignItems: "center", gap: 4, width: 52 },
  stepCircle: { width: 28, height: 28, borderRadius: 14, alignItems: "center", justifyContent: "center", borderWidth: 1.5 },
  stepLabel: { fontSize: 10, fontFamily: "Inter_500Medium" },
  stepLine: { flex: 1, height: 1.5, marginBottom: 14 },
  section: { padding: 16, gap: 10, borderWidth: 1 },
  sectionLabel: { fontSize: 11, fontFamily: "Inter_500Medium", textTransform: "uppercase", letterSpacing: 0.8 },
  farmerRow: { flexDirection: "row", alignItems: "center", gap: 12 },
  farmerAvatar: { width: 48, height: 48, borderRadius: 24, alignItems: "center", justifyContent: "center" },
  farmerName: { fontSize: 16, fontFamily: "Inter_600SemiBold" },
  farmerContact: { fontSize: 12, fontFamily: "Inter_400Regular" },
  farmerCode: { fontSize: 12, fontFamily: "Inter_400Regular", marginTop: 2 },
  groupBadge: { flexDirection: "row", alignItems: "center", gap: 5, alignSelf: "flex-start", paddingHorizontal: 8, paddingVertical: 3, borderRadius: 20, borderWidth: 1, marginTop: 4 },
  groupBadgeText: { fontSize: 11, fontFamily: "Inter_500Medium" },
  gpsRow: { flexDirection: "row", alignItems: "center", gap: 8 },
  gpsText: { flex: 1, fontSize: 13, fontFamily: "Inter_400Regular" },
  gpsAccuracy: { fontSize: 12, fontFamily: "Inter_400Regular" },
  retry: { fontSize: 13, fontFamily: "Inter_500Medium" },
  qtyRow: { flexDirection: "row", alignItems: "center", gap: 12 },
  qtyBtn: { width: 44, height: 44, alignItems: "center", justifyContent: "center" },
  qtyInput: { width: 80, height: 44, borderWidth: 1, fontSize: 20, fontFamily: "Inter_700Bold" },
  notesInput: { padding: 12, fontSize: 14, fontFamily: "Inter_400Regular", borderWidth: 1, minHeight: 80, textAlignVertical: "top" },
  dispatchBadge: { flexDirection: "row", alignItems: "center", gap: 8, padding: 10 },
  dispatchText: { fontSize: 13, fontFamily: "Inter_400Regular" },
  backBtn: { flexDirection: "row", alignItems: "center", gap: 6, padding: 10, borderWidth: 1, alignSelf: "flex-start" },
  backBtnText: { fontSize: 14, fontFamily: "Inter_500Medium" },
  actions: { flexDirection: "row", gap: 10, marginTop: 8, flexWrap: "wrap" },
  offlineBtn: { flex: 0.5, height: 52, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8, borderWidth: 1 },
  overrideBtn: { flex: 0.5, height: 52, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8, borderWidth: 1 },
  offlineBtnText: { fontSize: 14, fontFamily: "Inter_500Medium" },
  submitBtn: { flex: 1, height: 52, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 10 },
  submitBtnText: { color: "#fff", fontFamily: "Inter_600SemiBold", fontSize: 15 },
  devBanner: { flexDirection: "row", alignItems: "center", gap: 10, padding: 12, borderWidth: 1.5 },
  devBannerLabel: { fontSize: 11, fontFamily: "Inter_500Medium", color: "#92400e", textTransform: "uppercase", letterSpacing: 0.5 },
  devBannerCode: { fontSize: 28, fontFamily: "Inter_700Bold", color: "#92400e", letterSpacing: 6, marginTop: 2 },
  otpCard: { padding: 24, borderWidth: 1.5, alignItems: "center", gap: 8 },
  faceCard: { padding: 24, borderWidth: 1.5, alignItems: "center", gap: 12 },
  otpIconWrap: { width: 64, height: 64, borderRadius: 32, alignItems: "center", justifyContent: "center", marginBottom: 4 },
  otpTitle: { fontSize: 18, fontFamily: "Inter_700Bold" },
  otpSubtitle: { fontSize: 14, fontFamily: "Inter_400Regular", textAlign: "center" },
  otpPhone: { fontSize: 15, fontFamily: "Inter_600SemiBold", marginBottom: 8 },
  digitRow: { flexDirection: "row", gap: 8, marginTop: 4 },
  digitBox: { width: 44, height: 52, borderWidth: 1.5, fontSize: 22, fontFamily: "Inter_700Bold" },
  errorRow: { flexDirection: "row", alignItems: "center", gap: 6, marginTop: 4 },
  errorText: { fontSize: 13, fontFamily: "Inter_400Regular", flex: 1 },
  resendRow: { flexDirection: "row", alignItems: "center", gap: 8, marginTop: 8 },
  resendLabel: { fontSize: 13, fontFamily: "Inter_400Regular" },
  resendTimer: { fontSize: 13, fontFamily: "Inter_500Medium" },
  resendLink: { fontSize: 13, fontFamily: "Inter_600SemiBold" },
  photoWrap: { width: "100%", borderRadius: 12, overflow: "hidden", position: "relative" },
  photoPreview: { width: "100%", height: 260, borderRadius: 12 },
  photoBadge: { position: "absolute", bottom: 10, left: 10, flexDirection: "row", alignItems: "center", gap: 6, paddingHorizontal: 10, paddingVertical: 5, borderRadius: 20 },
  photoBadgeText: { color: "#fff", fontSize: 13, fontFamily: "Inter_600SemiBold" },
  cameraPlaceholder: { width: "100%", height: 200, borderRadius: 12, alignItems: "center", justifyContent: "center", gap: 10, borderWidth: 1.5, borderStyle: "dashed" },
  cameraPlaceholderText: { fontSize: 14, fontFamily: "Inter_400Regular" },
  faceLoadingRow: { flexDirection: "row", alignItems: "center", gap: 10 },
  faceLoadingText: { fontSize: 13, fontFamily: "Inter_400Regular" },
  cameraBtn: { flexDirection: "row", alignItems: "center", gap: 8, paddingHorizontal: 20, paddingVertical: 12, borderWidth: 1.5, marginTop: 4 },
  cameraBtnText: { fontSize: 15, fontFamily: "Inter_600SemiBold" },
  summaryCard: { padding: 14, gap: 8 },
  summaryRow: { flexDirection: "row", alignItems: "center", gap: 8 },
  summaryText: { fontSize: 13, fontFamily: "Inter_400Regular" },
  skipBanner: { flexDirection: "row", alignItems: "flex-start", gap: 10, padding: 12, borderWidth: 1 },
  skipBannerText: { flex: 1, fontSize: 13, fontFamily: "Inter_400Regular", lineHeight: 18 },
  skipOtpBtn: { flex: 0.5, height: 52, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8, borderWidth: 1 },
});
