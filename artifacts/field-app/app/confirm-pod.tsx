import { Feather } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import { useLocalSearchParams, useRouter } from "expo-router";
import React, { useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  Alert,
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
  compareFace,
  uploadPhotoToS3,
  type OtpSendResult,
  type FaceCompareResult,
  type PoD,
} from "@/lib/api";

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
    const pos = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced, timeInterval: 5000 });
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
      mediaTypes: ImagePicker.MediaTypeOptions.Images,
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

type Step = "details" | "otp" | "face" | "result";

export default function ConfirmPodScreen() {
  const { farmerId, farmerName, farmerCode, dispatchId } = useLocalSearchParams<{
    farmerId: string;
    farmerName: string;
    farmerCode: string;
    dispatchId?: string;
  }>();
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const { token } = useAuth();
  const { enqueue } = useOfflineQueue();
  const router = useRouter();

  const [step, setStep] = useState<Step>("details");

  // Details
  const [quantity, setQuantity] = useState("1");
  const [notes, setNotes] = useState("");
  const [gps, setGps] = useState<GPSCoords | null>(null);
  const [gpsLoading, setGpsLoading] = useState(false);

  // OTP
  const [otpResult, setOtpResult] = useState<OtpSendResult | null>(null);
  const [devCode, setDevCode] = useState<string | null>(null);
  const [digits, setDigits] = useState<string[]>(Array(OTP_LENGTH).fill(""));
  const [sendingOtp, setSendingOtp] = useState(false);
  const [verifying, setVerifying] = useState(false);
  const [otpError, setOtpError] = useState<string | null>(null);
  const [resendTimer, setResendTimer] = useState(0);
  const inputRefs = useRef<(TextInput | null)[]>([]);

  // Face
  const [facePhotoUri, setFacePhotoUri] = useState<string | null>(null);
  const [faceResult, setFaceResult] = useState<FaceCompareResult | null>(null);
  const [faceLoading, setFaceLoading] = useState(false);
  const [faceError, setFaceError] = useState<string | null>(null);

  // Submit
  const [submitting, setSubmitting] = useState(false);
  const [submittedPod, setSubmittedPod] = useState<PoD | null>(null);

  const bottomPad = Platform.OS === "web" ? 34 : insets.bottom;

  useEffect(() => { captureGPS(); }, []);
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
    try {
      const result = await sendOtp(token!, Number(farmerId));
      setOtpResult(result);
      setDevCode(result.devCode ?? null);
      setDigits(Array(OTP_LENGTH).fill(""));
      setResendTimer(RESEND_SECONDS);
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
        setFacePhotoUri(null);
        setFaceResult(null);
        setFaceError(null);
        setStep("face");
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
      const result = await sendOtp(token!, Number(farmerId));
      setOtpResult(result);
      setDevCode(result.devCode ?? null);
      setDigits(Array(OTP_LENGTH).fill(""));
      setResendTimer(RESEND_SECONDS);
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
      const result = await compareFace(token!, Number(farmerId), uploadInfo.key);
      setFaceResult(result);
      if (result.faceStatus === "Verified") {
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
          onPress: () => doSubmit("Verified", faceResult?.faceStatus ?? "Failed"),
        },
      ]
    );
  };

  const buildPayload = (otpStatus: string, faceStatus: string): Record<string, unknown> => ({
    farmerId: Number(farmerId),
    ...(dispatchId ? { dispatchId: Number(dispatchId) } : {}),
    quantityDelivered: Number(quantity),
    otpStatus,
    faceStatus,
    ...(gps ? { farmerLatitude: gps.latitude, farmerLongitude: gps.longitude } : {}),
    notes: notes || "Mobile field issuance",
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
      { key: "otp", label: "OTP", icon: "shield" as const },
      { key: "face", label: "Face ID", icon: "camera" as const },
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
        <Text style={[resultStyles.farmerLabel, { color: colors.mutedForeground }]}>
          {farmerName} · {quantity} unit{Number(quantity) !== 1 ? "s" : ""}
        </Text>

        {/* GPS status card */}
        <View style={[resultStyles.gpsCard, { backgroundColor: gpsColor + "14", borderColor: gpsColor + "35", borderRadius: colors.radius, width: "100%" }]}>
          <View style={[resultStyles.gpsIconWrap, { backgroundColor: gpsColor + "22" }]}>
            <Feather name={cfg.icon} size={26} color={gpsColor} />
          </View>
          <Text style={[resultStyles.gpsTitle, { color: gpsColor }]}>{cfg.title}</Text>
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
            { icon: "shield" as const,   label: "OTP",        val: submittedPod.otpStatus ?? "—",  ok: submittedPod.otpStatus === "Verified" },
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
                <Feather name="user" size={24} color={colors.primary} />
              </View>
              <View>
                <Text style={[styles.farmerName, { color: colors.foreground }]}>{farmerName}</Text>
                <Text style={[styles.farmerCode, { color: colors.mutedForeground }]}>{farmerCode}</Text>
              </View>
            </View>
          </View>

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

          <View style={styles.actions}>
            <TouchableOpacity
              style={[styles.offlineBtn, { borderColor: colors.border, borderRadius: colors.radius }]}
              onPress={() => doSubmit("Bypassed", "Bypassed", true)}
              disabled={sendingOtp || submitting}
              activeOpacity={0.8}
            >
              <Feather name="wifi-off" size={16} color={colors.mutedForeground} />
              <Text style={[styles.offlineBtnText, { color: colors.mutedForeground }]}>Save Offline</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.submitBtn, { backgroundColor: colors.primary, borderRadius: colors.radius, opacity: sendingOtp ? 0.7 : 1 }]}
              onPress={handleSendOtp}
              disabled={sendingOtp || submitting}
              activeOpacity={0.85}
            >
              {sendingOtp ? <ActivityIndicator color="#fff" /> : (
                <>
                  <Feather name="shield" size={18} color="#fff" />
                  <Text style={styles.submitBtnText}>Verify Farmer</Text>
                </>
              )}
            </TouchableOpacity>
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    );
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // STEP 2 — OTP
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
            onPress={() => { setStep("details"); setOtpError(null); }}
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
                  {otpResult?.channel === "whatsapp" ? "WhatsApp sent (join sandbox first)"
                    : otpResult?.channel === "sms" ? "SMS attempted" : "Not delivered to handset"}
                </Text>
                <Text style={styles.devBannerCode}>{devCode}</Text>
              </View>
            </View>
          )}

          <View style={[styles.otpCard, { backgroundColor: colors.card, borderColor: colors.primary + "40", borderRadius: colors.radius }]}>
            <View style={[styles.otpIconWrap, { backgroundColor: colors.primary + "12" }]}>
              <Feather name={otpResult?.channel === "whatsapp" ? "message-circle" : "shield"} size={32} color={colors.primary} />
            </View>
            <Text style={[styles.otpTitle, { color: colors.foreground }]}>SMS Verification</Text>
            <Text style={[styles.otpSubtitle, { color: colors.mutedForeground }]}>
              {otpResult?.channel === "whatsapp" ? "A 6-digit code was sent via WhatsApp to"
                : otpResult?.channel === "sms" ? "A 6-digit code was sent via SMS to"
                : "A 6-digit code was sent to"}
            </Text>
            <Text style={[styles.otpPhone, { color: colors.foreground }]}>
              {otpResult?.maskedPhone ?? "the farmer's phone"}
            </Text>
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
              <Text style={[styles.resendLabel, { color: colors.mutedForeground }]}>Didn't receive it?</Text>
              {resendTimer > 0 ? (
                <Text style={[styles.resendTimer, { color: colors.mutedForeground }]}>Resend in {resendTimer}s</Text>
              ) : (
                <TouchableOpacity onPress={handleResend} disabled={sendingOtp}>
                  <Text style={[styles.resendLink, { color: colors.primary }]}>
                    {sendingOtp ? "Sending…" : "Resend Code"}
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

          <View style={styles.actions}>
            <TouchableOpacity
              style={[styles.offlineBtn, { borderColor: colors.border, borderRadius: colors.radius }]}
              onPress={() => doSubmit("Bypassed", "Bypassed", true)}
              disabled={verifying || submitting}
              activeOpacity={0.8}
            >
              <Feather name="wifi-off" size={16} color={colors.mutedForeground} />
              <Text style={[styles.offlineBtnText, { color: colors.mutedForeground }]}>Save Offline</Text>
            </TouchableOpacity>
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
          onPress={() => { setStep("otp"); setFacePhotoUri(null); setFaceResult(null); setFaceError(null); }}
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
              ? `Face did not match${faceResult?.similarity != null ? ` (${faceResult.similarity}% similarity)` : ""}`
              : "Take a clear photo of the farmer's face for identity check"}
          </Text>

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
            <Feather name="shield" size={14} color={colors.success} />
            <Text style={[styles.summaryText, { color: colors.success }]}>OTP verified</Text>
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
              onPress={() => doSubmit("Verified", "Bypassed")}
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
              onPress={() => doSubmit("Verified", faceResult?.faceStatus ?? "Verified")}
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
  farmerLabel: { fontSize: 13, fontFamily: "Inter_400Regular", marginTop: 4, marginBottom: 20 },
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
  stepItem: { alignItems: "center", gap: 4, width: 64 },
  stepCircle: { width: 28, height: 28, borderRadius: 14, alignItems: "center", justifyContent: "center", borderWidth: 1.5 },
  stepLabel: { fontSize: 10, fontFamily: "Inter_500Medium" },
  stepLine: { flex: 1, height: 1.5, marginBottom: 14 },
  section: { padding: 16, gap: 10, borderWidth: 1 },
  sectionLabel: { fontSize: 11, fontFamily: "Inter_500Medium", textTransform: "uppercase", letterSpacing: 0.8 },
  farmerRow: { flexDirection: "row", alignItems: "center", gap: 12 },
  farmerAvatar: { width: 48, height: 48, borderRadius: 24, alignItems: "center", justifyContent: "center" },
  farmerName: { fontSize: 16, fontFamily: "Inter_600SemiBold" },
  farmerCode: { fontSize: 12, fontFamily: "Inter_400Regular", marginTop: 2 },
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
});
