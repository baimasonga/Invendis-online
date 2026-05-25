import { Feather } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import { useLocalSearchParams, useRouter } from "expo-router";
import React, { useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Platform,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useAuth } from "@/context/AuthContext";
import { useColors } from "@/hooks/useColors";
import { farmerByBarcode, searchFarmers, type Farmer } from "@/lib/api";

let CameraView: React.ComponentType<{
  style?: object;
  onBarcodeScanned?: (data: { data: string }) => void;
  barcodeScannerSettings?: { barcodeTypes: string[] };
}> | null = null;
type CameraPermission = { granted: boolean } | null;
type RequestCameraPermission = (() => Promise<unknown>) | null;
let useCameraPermissions: (() => [CameraPermission, RequestCameraPermission]) | null = null;

if (Platform.OS !== "web") {
  try {
    const cam = require("expo-camera");
    CameraView = cam.CameraView;
    useCameraPermissions = cam.useCameraPermissions;
  } catch {}
}

export default function ScanFarmerScreen() {
  const { dispatchId } = useLocalSearchParams<{ dispatchId?: string }>();
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const { token } = useAuth();
  const router = useRouter();
  const [mode, setMode] = useState<"camera" | "manual">("camera");
  const [input, setInput] = useState("");
  const [farmer, setFarmer] = useState<Farmer | null>(null);
  const [loading, setLoading] = useState(false);
  const [scanned, setScanned] = useState(false);

  const camPerms = useCameraPermissions ? useCameraPermissions() : [null, null];
  const [camPermission, requestCamPermission] = camPerms;
  const bottomPad = Platform.OS === "web" ? 34 : insets.bottom;

  const lookup = async (code: string) => {
    if (!token || loading) return;
    setLoading(true);
    setFarmer(null);
    try {
      const result = await farmerByBarcode(token, code);
      setFarmer(result);
      await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    } catch {
      const results = await searchFarmers(token, code).catch(() => ({ data: [] as Farmer[] }));
      if (results.data.length > 0) {
        setFarmer(results.data[0]);
        await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      } else {
        Alert.alert("Not Found", "No farmer found with this code.");
        await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
      }
    } finally {
      setLoading(false);
    }
  };

  const handleBarcodeScanned = async ({ data }: { data: string }) => {
    if (scanned) return;
    setScanned(true);
    await lookup(data);
    setTimeout(() => setScanned(false), 2000);
  };

  const handleConfirm = () => {
    if (!farmer) return;
    const params = new URLSearchParams({
      farmerId: String(farmer.id),
      farmerName: `${farmer.firstName} ${farmer.lastName}`,
      farmerCode: farmer.farmerCode,
      ...(dispatchId ? { dispatchId } : {}),
    });
    router.push(`/confirm-pod?${params.toString()}`);
  };

  return (
    <View style={[styles.root, { backgroundColor: colors.background }]}>
      <View style={[styles.modeSwitcher, { borderBottomColor: colors.border, backgroundColor: colors.background }]}>
        {(["camera", "manual"] as const).map((m) => (
          <TouchableOpacity
            key={m}
            style={[styles.modeBtn, m === mode && { borderBottomColor: colors.primary, borderBottomWidth: 2 }]}
            onPress={() => { setMode(m); setFarmer(null); }}
          >
            <Feather name={m === "camera" ? "camera" : "search"} size={16} color={m === mode ? colors.primary : colors.mutedForeground} />
            <Text style={[styles.modeBtnText, { color: m === mode ? colors.primary : colors.mutedForeground }]}>
              {m === "camera" ? "Scan Barcode" : "Manual Search"}
            </Text>
          </TouchableOpacity>
        ))}
      </View>

      {mode === "camera" ? (
        <View style={styles.cameraArea}>
          {Platform.OS === "web" || !CameraView ? (
            <View style={[styles.camUnavail, { backgroundColor: colors.muted }]}>
              <Feather name="camera-off" size={40} color={colors.mutedForeground} />
              <Text style={[styles.camUnavailText, { color: colors.mutedForeground }]}>Camera not available on web</Text>
              <TouchableOpacity style={[styles.switchBtn, { backgroundColor: colors.primary, borderRadius: colors.radius }]} onPress={() => setMode("manual")}>
                <Text style={styles.switchBtnTxt}>Switch to Search</Text>
              </TouchableOpacity>
            </View>
          ) : !camPermission ? (
            <ActivityIndicator color={colors.primary} style={{ marginTop: 64 }} />
          ) : !camPermission.granted ? (
            <View style={[styles.camUnavail, { backgroundColor: colors.muted }]}>
              <Feather name="lock" size={40} color={colors.mutedForeground} />
              <Text style={[styles.camUnavailText, { color: colors.foreground }]}>Camera permission needed</Text>
              <TouchableOpacity style={[styles.switchBtn, { backgroundColor: colors.primary, borderRadius: colors.radius }]} onPress={() => { void requestCamPermission?.(); }}>
                <Text style={styles.switchBtnTxt}>Grant Access</Text>
              </TouchableOpacity>
            </View>
          ) : (
            <View style={styles.cameraWrap}>
              <CameraView
                style={StyleSheet.absoluteFillObject}
                onBarcodeScanned={handleBarcodeScanned}
                barcodeScannerSettings={{ barcodeTypes: ["qr", "code128", "code39", "ean13"] }}
              />
              <View style={styles.overlay}>
                <View style={[styles.frame, { borderColor: colors.primary }]} />
                <Text style={styles.hint}>Point at farmer QR or barcode</Text>
              </View>
              {loading && (
                <View style={[styles.scanningBanner, { backgroundColor: colors.primary }]}>
                  <ActivityIndicator color="#fff" size="small" />
                  <Text style={styles.scanningText}>Looking up farmer…</Text>
                </View>
              )}
            </View>
          )}
        </View>
      ) : (
        <View style={styles.manualArea}>
          <TextInput
            style={[styles.input, { backgroundColor: colors.muted, borderColor: colors.border, color: colors.foreground, borderRadius: colors.radius }]}
            placeholder="Enter farmer code or name…"
            placeholderTextColor={colors.mutedForeground}
            value={input}
            onChangeText={setInput}
            autoCapitalize="characters"
            returnKeyType="search"
            onSubmitEditing={() => input.trim() && lookup(input.trim())}
          />
          <TouchableOpacity
            style={[styles.lookupBtn, { backgroundColor: colors.primary, borderRadius: colors.radius, opacity: loading ? 0.7 : 1 }]}
            onPress={() => input.trim() && lookup(input.trim())}
            disabled={loading}
            activeOpacity={0.85}
          >
            {loading ? <ActivityIndicator color="#fff" /> : <Text style={styles.lookupBtnTxt}>Search Farmer</Text>}
          </TouchableOpacity>
        </View>
      )}

      {farmer && (
        <View style={[styles.farmerPanel, { borderTopColor: colors.border, paddingBottom: bottomPad + 16, backgroundColor: colors.background }]}>
          <View style={[styles.farmerCard, { backgroundColor: colors.card, borderColor: colors.primary + "40", borderRadius: colors.radius }]}>
            <View style={[styles.avatar, { backgroundColor: colors.primary + "18" }]}>
              <Feather name="user" size={28} color={colors.primary} />
            </View>
            <View style={styles.farmerDetails}>
              <Text style={[styles.farmerName, { color: colors.foreground }]}>{farmer.firstName} {farmer.lastName}</Text>
              <Text style={[styles.farmerCode, { color: colors.mutedForeground }]}>{farmer.farmerCode}</Text>
              {farmer.phone && <Text style={[styles.farmerPhone, { color: colors.mutedForeground }]}>{farmer.phone}</Text>}
            </View>
          </View>
          <TouchableOpacity
            style={[styles.confirmBtn, { backgroundColor: colors.primary, borderRadius: colors.radius }]}
            onPress={handleConfirm}
            activeOpacity={0.85}
          >
            <Text style={styles.confirmBtnTxt}>Issue Items to this Farmer</Text>
            <Feather name="arrow-right" size={18} color="#fff" />
          </TouchableOpacity>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  modeSwitcher: { flexDirection: "row", borderBottomWidth: 1 },
  modeBtn: { flex: 1, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8, paddingVertical: 14 },
  modeBtnText: { fontSize: 14, fontFamily: "Inter_500Medium" },
  cameraArea: { flex: 1 },
  cameraWrap: { flex: 1 },
  overlay: { ...StyleSheet.absoluteFillObject, alignItems: "center", justifyContent: "center", gap: 20 },
  frame: { width: 220, height: 220, borderWidth: 2.5, borderRadius: 16 },
  hint: { color: "#fff", fontFamily: "Inter_500Medium", fontSize: 13 },
  scanningBanner: { position: "absolute", bottom: 32, left: 32, right: 32, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 10, padding: 12, borderRadius: 12 },
  scanningText: { color: "#fff", fontFamily: "Inter_500Medium", fontSize: 14 },
  camUnavail: { flex: 1, alignItems: "center", justifyContent: "center", gap: 16, padding: 32 },
  camUnavailText: { fontSize: 15, fontFamily: "Inter_400Regular", textAlign: "center" },
  switchBtn: { paddingHorizontal: 24, paddingVertical: 12 },
  switchBtnTxt: { color: "#fff", fontFamily: "Inter_600SemiBold", fontSize: 14 },
  manualArea: { padding: 24, gap: 14 },
  input: { height: 50, paddingHorizontal: 14, fontSize: 15, fontFamily: "Inter_400Regular", borderWidth: 1 },
  lookupBtn: { height: 50, alignItems: "center", justifyContent: "center" },
  lookupBtnTxt: { color: "#fff", fontFamily: "Inter_600SemiBold", fontSize: 15 },
  farmerPanel: { padding: 16, gap: 12, borderTopWidth: 1 },
  farmerCard: { flexDirection: "row", alignItems: "center", padding: 14, gap: 12, borderWidth: 1.5 },
  avatar: { width: 52, height: 52, borderRadius: 26, alignItems: "center", justifyContent: "center" },
  farmerDetails: { flex: 1, gap: 3 },
  farmerName: { fontSize: 16, fontFamily: "Inter_600SemiBold" },
  farmerCode: { fontSize: 12, fontFamily: "Inter_400Regular" },
  farmerPhone: { fontSize: 12, fontFamily: "Inter_400Regular" },
  confirmBtn: { height: 52, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 10 },
  confirmBtnTxt: { color: "#fff", fontFamily: "Inter_600SemiBold", fontSize: 15 },
});
