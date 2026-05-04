import { Feather } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import { useLocalSearchParams, useRouter } from "expo-router";
import React, { useEffect, useState } from "react";
import {
  ActivityIndicator,
  Alert,
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
import { submitPoD } from "@/lib/api";

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

  const [quantity, setQuantity] = useState("1");
  const [notes, setNotes] = useState("");
  const [gps, setGps] = useState<GPSCoords | null>(null);
  const [gpsLoading, setGpsLoading] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const bottomPad = Platform.OS === "web" ? 34 : insets.bottom;

  useEffect(() => {
    captureGPS();
  }, []);

  const captureGPS = async () => {
    setGpsLoading(true);
    const coords = await getLocation();
    setGps(coords);
    setGpsLoading(false);
  };

  const handleSubmit = async (offline = false) => {
    const qty = Number(quantity);
    if (isNaN(qty) || qty <= 0) {
      Alert.alert("Invalid Quantity", "Please enter a valid quantity.");
      return;
    }

    const payload: Record<string, unknown> = {
      farmerId: Number(farmerId),
      ...(dispatchId ? { dispatchId: Number(dispatchId) } : {}),
      quantityReceived: qty,
      otpStatus: "Bypassed",
      faceStatus: "Bypassed",
      ...(gps ? { farmerLatitude: String(gps.latitude), farmerLongitude: String(gps.longitude) } : {}),
      notes: notes || "Mobile field issuance",
    };

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
        Alert.alert("Success", "Proof of Delivery submitted successfully.", [
          { text: "OK", onPress: () => router.back() },
        ]);
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Failed to submit";
      Alert.alert(
        "Submission Failed",
        `${msg}\n\nWould you like to save this PoD offline and sync later?`,
        [
          { text: "Cancel", style: "cancel" },
          { text: "Save Offline", onPress: () => handleSubmit(true) },
        ]
      );
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <ScrollView
      style={[styles.root, { backgroundColor: colors.background }]}
      contentContainerStyle={[styles.content, { paddingBottom: bottomPad + 32 }]}
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

      {/* Dispatch info */}
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
          onPress={() => handleSubmit(true)}
          disabled={submitting}
          activeOpacity={0.8}
        >
          <Feather name="wifi-off" size={16} color={colors.mutedForeground} />
          <Text style={[styles.offlineBtnText, { color: colors.mutedForeground }]}>Save Offline</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.submitBtn, { backgroundColor: colors.primary, borderRadius: colors.radius, opacity: submitting ? 0.7 : 1 }]}
          onPress={() => handleSubmit(false)}
          disabled={submitting}
          activeOpacity={0.85}
        >
          {submitting ? (
            <ActivityIndicator color="#fff" />
          ) : (
            <>
              <Feather name="check-circle" size={18} color="#fff" />
              <Text style={styles.submitBtnText}>Submit PoD</Text>
            </>
          )}
        </TouchableOpacity>
      </View>
    </ScrollView>
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
});
