import { Feather } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import { useLocalSearchParams, useRouter } from "expo-router";
import React, { useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  Alert,
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
import { sendOtp, verifyOtp, submitPoD, type OtpSendResult } from "@/lib/api";

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

const OTP_LENGTH = 6;
const RESEND_SECONDS = 60;

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

  // Step: "details" | "otp"
  const [step, setStep] = useState<"details" | "otp">("details");

  // Details step state
  const [quantity, setQuantity] = useState("1");
  const [notes, setNotes] = useState("");
  const [gps, setGps] = useState<GPSCoords | null>(null);
  const [gpsLoading, setGpsLoading] = useState(false);

  // OTP step state
  const [otpResult, setOtpResult] = useState<OtpSendResult | null>(null);
  const [devCode, setDevCode] = useState<string | null>(null);
  const [digits, setDigits] = useState<string[]>(Array(OTP_LENGTH).fill(""));
  const [sendingOtp, setSendingOtp] = useState(false);
  const [verifying, setVerifying] = useState(false);
  const [otpError, setOtpError] = useState<string | null>(null);
  const [resendTimer, setResendTimer] = useState(0);
  const inputRefs = useRef<(TextInput | null)[]>([]);

  // Submission
  const [submitting, setSubmitting] = useState(false);

  const bottomPad = Platform.OS === "web" ? 34 : insets.bottom;

  useEffect(() => {
    captureGPS();
  }, []);

  // Resend countdown ticker
  useEffect(() => {
    if (resendTimer <= 0) return;
    const t = setTimeout(() => setResendTimer((s) => s - 1), 1000);
    return () => clearTimeout(t);
  }, [resendTimer]);

  const captureGPS = async () => {
    setGpsLoading(true);
    const coords = await getLocation();
    setGps(coords);
    setGpsLoading(false);
  };

  // ─── Send OTP ───────────────────────────────────────────────────────────────
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
      // If farmer has no phone, offer to bypass
      if (msg.toLowerCase().includes("no registered phone")) {
        Alert.alert(
          "No Phone Number",
          "This farmer has no registered phone number. You can submit without SMS verification, but the record will be flagged.",
          [
            { text: "Cancel", style: "cancel" },
            { text: "Submit Anyway", onPress: () => doSubmit("NoPhone") },
          ]
        );
      } else {
        Alert.alert("SMS Error", msg);
      }
    } finally {
      setSendingOtp(false);
    }
  };

  // ─── Handle digit input ──────────────────────────────────────────────────────
  const handleDigitChange = (text: string, index: number) => {
    const val = text.replace(/\D/g, "").slice(-1);
    const next = [...digits];
    next[index] = val;
    setDigits(next);
    setOtpError(null);
    if (val && index < OTP_LENGTH - 1) {
      inputRefs.current[index + 1]?.focus();
    }
    // Auto-verify when all 6 digits entered
    if (val && next.every((d) => d !== "")) {
      handleVerify(next.join(""));
    }
  };

  const handleDigitKeyPress = (key: string, index: number) => {
    if (key === "Backspace" && !digits[index] && index > 0) {
      inputRefs.current[index - 1]?.focus();
    }
  };

  // ─── Verify OTP ──────────────────────────────────────────────────────────────
  const handleVerify = async (code?: string) => {
    const enteredCode = code ?? digits.join("");
    if (enteredCode.length < OTP_LENGTH) {
      setOtpError("Please enter all 6 digits.");
      return;
    }
    setVerifying(true);
    setOtpError(null);
    try {
      const result = await verifyOtp(token!, Number(farmerId), enteredCode);
      if (result.verified) {
        await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
        await doSubmit("Verified");
      } else {
        setOtpError(result.error ?? "Invalid code. Please try again.");
        await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Verification failed";
      setOtpError(msg);
      await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
    } finally {
      setVerifying(false);
    }
  };

  // ─── Resend ──────────────────────────────────────────────────────────────────
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

  // ─── Build payload and submit ────────────────────────────────────────────────
  const buildPayload = (otpStatus: string): Record<string, unknown> => ({
    farmerId: Number(farmerId),
    ...(dispatchId ? { dispatchId: Number(dispatchId) } : {}),
    quantityDelivered: Number(quantity),
    otpStatus,
    faceStatus: "Bypassed",
    ...(gps ? { farmerLatitude: String(gps.latitude), farmerLongitude: String(gps.longitude) } : {}),
    notes: notes || "Mobile field issuance",
  });

  const doSubmit = async (otpStatus: string, offline = false) => {
    const payload = buildPayload(otpStatus);
    setSubmitting(true);
    try {
      if (offline) {
        await enqueue(payload);
        await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
        Alert.alert("Saved Offline", "PoD queued. It will sync when you're back online.", [
          { text: "OK", onPress: () => router.back() },
        ]);
      } else {
        await submitPoD(token!, payload);
        await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
        Alert.alert("Success", "Proof of Delivery recorded successfully.", [
          { text: "OK", onPress: () => router.back() },
        ]);
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Failed to submit";
      Alert.alert(
        "Submission Failed",
        `${msg}\n\nSave offline and sync later?`,
        [
          { text: "Cancel", style: "cancel" },
          { text: "Save Offline", onPress: () => doSubmit(otpStatus, true) },
        ]
      );
    } finally {
      setSubmitting(false);
    }
  };

  // ═══════════════════════════════════════════════════════════════════════════
  // RENDER — Step 1: Details
  // ═══════════════════════════════════════════════════════════════════════════
  if (step === "details") {
    return (
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === "ios" ? "padding" : undefined}>
        <ScrollView
          style={[styles.root, { backgroundColor: colors.background }]}
          contentContainerStyle={[styles.content, { paddingBottom: bottomPad + 32 }]}
          keyboardShouldPersistTaps="handled"
        >
          {/* Farmer info */}
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

          {/* GPS */}
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
                {gps.accuracy && (
                  <Text style={[styles.gpsAccuracy, { color: colors.mutedForeground }]}>±{Math.round(gps.accuracy)}m</Text>
                )}
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

          {/* Quantity */}
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

          {/* Notes */}
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

          {/* Dispatch badge */}
          {dispatchId && (
            <View style={[styles.dispatchBadge, { backgroundColor: colors.muted, borderRadius: colors.radius }]}>
              <Feather name="truck" size={14} color={colors.mutedForeground} />
              <Text style={[styles.dispatchText, { color: colors.mutedForeground }]}>Dispatch #{dispatchId}</Text>
            </View>
          )}

          {/* Actions */}
          <View style={styles.actions}>
            <TouchableOpacity
              style={[styles.offlineBtn, { borderColor: colors.border, borderRadius: colors.radius }]}
              onPress={() => doSubmit("Bypassed", true)}
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
              {sendingOtp ? (
                <ActivityIndicator color="#fff" />
              ) : (
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
  // RENDER — Step 2: OTP Verification
  // ═══════════════════════════════════════════════════════════════════════════
  return (
    <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === "ios" ? "padding" : undefined}>
      <ScrollView
        style={[styles.root, { backgroundColor: colors.background }]}
        contentContainerStyle={[styles.content, { paddingBottom: bottomPad + 32 }]}
        keyboardShouldPersistTaps="handled"
      >
        {/* Back to details */}
        <TouchableOpacity
          style={[styles.backBtn, { borderColor: colors.border, borderRadius: colors.radius }]}
          onPress={() => { setStep("details"); setOtpError(null); }}
        >
          <Feather name="arrow-left" size={16} color={colors.mutedForeground} />
          <Text style={[styles.backBtnText, { color: colors.mutedForeground }]}>Back</Text>
        </TouchableOpacity>

        {/* Dev mode code banner */}
        {devCode && (
          <View style={[styles.devBanner, { backgroundColor: "#fef3c7", borderColor: "#f59e0b", borderRadius: colors.radius }]}>
            <Feather name="terminal" size={16} color="#92400e" />
            <View style={{ flex: 1 }}>
              <Text style={styles.devBannerLabel}>
                Dev Mode —{" "}
                {otpResult?.channel === "whatsapp"
                  ? "WhatsApp sent (join sandbox first)"
                  : otpResult?.channel === "sms"
                  ? "SMS attempted"
                  : "Not delivered to handset"}
              </Text>
              <Text style={styles.devBannerCode}>{devCode}</Text>
            </View>
          </View>
        )}

        {/* OTP card */}
        <View style={[styles.otpCard, { backgroundColor: colors.card, borderColor: colors.primary + "40", borderRadius: colors.radius }]}>
          {/* Header */}
          <View style={[styles.otpIconWrap, { backgroundColor: colors.primary + "12" }]}>
            <Feather name={otpResult?.channel === "whatsapp" ? "message-circle" : "shield"} size={32} color={colors.primary} />
          </View>
          <Text style={[styles.otpTitle, { color: colors.foreground }]}>Farmer Verification</Text>
          <Text style={[styles.otpSubtitle, { color: colors.mutedForeground }]}>
            {otpResult?.channel === "whatsapp"
              ? "A 6-digit code was sent via WhatsApp to"
              : otpResult?.channel === "sms"
              ? "A 6-digit code was sent via SMS to"
              : "A 6-digit code was sent to"}
          </Text>
          <Text style={[styles.otpPhone, { color: colors.foreground }]}>
            {otpResult?.maskedPhone ?? "the farmer's phone"}
          </Text>

          {/* 6-digit boxes */}
          <View style={styles.digitRow}>
            {digits.map((d, i) => (
              <TextInput
                key={i}
                ref={(r) => { inputRefs.current[i] = r; }}
                style={[
                  styles.digitBox,
                  {
                    borderColor: otpError ? colors.destructive : d ? colors.primary : colors.border,
                    color: colors.foreground,
                    backgroundColor: colors.muted,
                    borderRadius: colors.radius,
                  },
                ]}
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

          {/* Error message */}
          {otpError && (
            <View style={styles.errorRow}>
              <Feather name="alert-circle" size={14} color={colors.destructive} />
              <Text style={[styles.errorText, { color: colors.destructive }]}>{otpError}</Text>
            </View>
          )}

          {/* Resend */}
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

        {/* Summary card */}
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

        {/* Actions */}
        <View style={styles.actions}>
          <TouchableOpacity
            style={[styles.offlineBtn, { borderColor: colors.border, borderRadius: colors.radius }]}
            onPress={() => doSubmit("Bypassed", true)}
            disabled={verifying || submitting}
            activeOpacity={0.8}
          >
            <Feather name="wifi-off" size={16} color={colors.mutedForeground} />
            <Text style={[styles.offlineBtnText, { color: colors.mutedForeground }]}>Save Offline</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[
              styles.submitBtn,
              { backgroundColor: colors.primary, borderRadius: colors.radius, opacity: (verifying || submitting) ? 0.7 : 1 },
            ]}
            onPress={() => handleVerify()}
            disabled={verifying || submitting}
            activeOpacity={0.85}
          >
            {(verifying || submitting) ? (
              <ActivityIndicator color="#fff" />
            ) : (
              <>
                <Feather name="check-circle" size={18} color="#fff" />
                <Text style={styles.submitBtnText}>Confirm & Submit</Text>
              </>
            )}
          </TouchableOpacity>
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  content: { padding: 16, gap: 12 },
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
  actions: { flexDirection: "row", gap: 10, marginTop: 8 },
  offlineBtn: { flex: 0.5, height: 52, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8, borderWidth: 1 },
  offlineBtnText: { fontSize: 14, fontFamily: "Inter_500Medium" },
  submitBtn: { flex: 1, height: 52, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 10 },
  submitBtnText: { color: "#fff", fontFamily: "Inter_600SemiBold", fontSize: 15 },
  // Dev banner
  devBanner: { flexDirection: "row", alignItems: "center", gap: 10, padding: 12, borderWidth: 1.5 },
  devBannerLabel: { fontSize: 11, fontFamily: "Inter_500Medium", color: "#92400e", textTransform: "uppercase", letterSpacing: 0.5 },
  devBannerCode: { fontSize: 28, fontFamily: "Inter_700Bold", color: "#92400e", letterSpacing: 6, marginTop: 2 },
  // OTP step
  backBtn: { flexDirection: "row", alignItems: "center", gap: 6, padding: 10, borderWidth: 1, alignSelf: "flex-start" },
  backBtnText: { fontSize: 14, fontFamily: "Inter_500Medium" },
  otpCard: { padding: 24, borderWidth: 1.5, alignItems: "center", gap: 8 },
  otpIconWrap: { width: 64, height: 64, borderRadius: 32, alignItems: "center", justifyContent: "center", marginBottom: 4 },
  otpTitle: { fontSize: 18, fontFamily: "Inter_700Bold" },
  otpSubtitle: { fontSize: 14, fontFamily: "Inter_400Regular" },
  otpPhone: { fontSize: 15, fontFamily: "Inter_600SemiBold", marginBottom: 8 },
  digitRow: { flexDirection: "row", gap: 8, marginTop: 4 },
  digitBox: {
    width: 44,
    height: 52,
    borderWidth: 1.5,
    fontSize: 22,
    fontFamily: "Inter_700Bold",
  },
  errorRow: { flexDirection: "row", alignItems: "center", gap: 6, marginTop: 4 },
  errorText: { fontSize: 13, fontFamily: "Inter_400Regular" },
  resendRow: { flexDirection: "row", alignItems: "center", gap: 8, marginTop: 8 },
  resendLabel: { fontSize: 13, fontFamily: "Inter_400Regular" },
  resendTimer: { fontSize: 13, fontFamily: "Inter_500Medium" },
  resendLink: { fontSize: 13, fontFamily: "Inter_600SemiBold" },
  summaryCard: { padding: 14, gap: 8 },
  summaryRow: { flexDirection: "row", alignItems: "center", gap: 8 },
  summaryText: { fontSize: 13, fontFamily: "Inter_400Regular" },
});
