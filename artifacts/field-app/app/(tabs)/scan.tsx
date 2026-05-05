import { Feather } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import { useRouter } from "expo-router";
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
import {
  farmerByBarcode,
  searchFarmers,
  getDispatchByManifestCode,
  type Farmer,
  type Dispatch,
} from "@/lib/api";

let CameraView: React.ComponentType<{
  style?: object;
  onBarcodeScanned?: (data: { data: string }) => void;
  barcodeScannerSettings?: { barcodeTypes: string[] };
}> | null = null;
let useCameraPermissions: (() => [{ granted: boolean } | null, () => Promise<void>]) | null = null;

if (Platform.OS !== "web") {
  try {
    const cam = require("expo-camera");
    CameraView = cam.CameraView;
    useCameraPermissions = cam.useCameraPermissions;
  } catch {}
}

type ScanMode = "farmer" | "manifest";

function FarmerResult({ farmer, onIssue }: { farmer: Farmer; onIssue: () => void }) {
  const colors = useColors();
  return (
    <View style={[styles.farmerCard, { backgroundColor: colors.card, borderRadius: colors.radius, borderColor: colors.primary + "40" }]}>
      <View style={[styles.farmerAvatar, { backgroundColor: colors.primary + "18" }]}>
        <Feather name="user" size={28} color={colors.primary} />
      </View>
      <View style={styles.farmerInfo}>
        <Text style={[styles.farmerName, { color: colors.foreground }]}>
          {farmer.firstName} {farmer.lastName}
        </Text>
        <Text style={[styles.farmerCode, { color: colors.mutedForeground }]}>{farmer.farmerCode}</Text>
        {farmer.ageGroup && (
          <Text style={[styles.farmerMeta, { color: colors.mutedForeground }]}>
            <Feather name="user" size={11} /> {farmer.ageGroup} · {farmer.gender ?? ""}
          </Text>
        )}
      </View>
      <TouchableOpacity
        style={[styles.issueBtn, { backgroundColor: colors.primary, borderRadius: colors.radius }]}
        onPress={onIssue}
        activeOpacity={0.85}
      >
        <Text style={styles.issueBtnText}>Issue</Text>
        <Feather name="arrow-right" size={14} color="#fff" />
      </TouchableOpacity>
    </View>
  );
}

function ManifestResult({ dispatch, onRecord }: { dispatch: Dispatch; onRecord: () => void }) {
  const colors = useColors();
  const statusColors: Record<string, string> = {
    arrived: colors.success,
    completed: colors.success,
  };
  const statusColor = statusColors[(dispatch.status ?? "").toLowerCase()] ?? colors.warning;
  return (
    <View style={[styles.farmerCard, { backgroundColor: colors.card, borderRadius: colors.radius, borderColor: colors.primary + "40" }]}>
      <View style={[styles.farmerAvatar, { backgroundColor: colors.primary + "18" }]}>
        <Feather name="truck" size={24} color={colors.primary} />
      </View>
      <View style={styles.farmerInfo}>
        <Text style={[styles.farmerName, { color: colors.foreground }]}>{dispatch.manifestCode}</Text>
        <Text style={[styles.farmerCode, { color: colors.mutedForeground }]}>
          {dispatch.destinationCommunity ?? dispatch.destinationDistrict ?? "—"}
        </Text>
        <Text style={[styles.farmerMeta, { color: statusColor }]}>{dispatch.status}</Text>
      </View>
      <TouchableOpacity
        style={[styles.issueBtn, { backgroundColor: colors.primary, borderRadius: colors.radius }]}
        onPress={onRecord}
        activeOpacity={0.85}
      >
        <Text style={styles.issueBtnText}>Open</Text>
        <Feather name="arrow-right" size={14} color="#fff" />
      </TouchableOpacity>
    </View>
  );
}

export default function ScanScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const { token } = useAuth();
  const router = useRouter();

  const [scanMode, setScanMode] = useState<ScanMode>("farmer");
  const [cameraActive, setCameraActive] = useState(true);
  const [manualInput, setManualInput] = useState("");
  const [farmer, setFarmer] = useState<Farmer | null>(null);
  const [dispatch, setDispatch] = useState<Dispatch | null>(null);
  const [loading, setLoading] = useState(false);
  const [scanned, setScanned] = useState(false);

  const camPerms = useCameraPermissions ? useCameraPermissions() : [null, async () => {}];
  const [camPermission, requestCamPermission] = camPerms;

  const topPad = Platform.OS === "web" ? 67 : insets.top;

  // ─── Farmer lookup ────────────────────────────────────────────────────────
  const lookupFarmer = async (code: string) => {
    if (!token || loading) return;
    setLoading(true);
    setFarmer(null);
    setDispatch(null);
    try {
      const result = await farmerByBarcode(token, code);
      setFarmer(result);
      await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    } catch {
      try {
        const results = await searchFarmers(token, code);
        if (results.data.length > 0) {
          setFarmer(results.data[0]);
          await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
        } else {
          Alert.alert("Not Found", "No farmer found with this code. Try a different search.");
          await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
        }
      } catch {
        Alert.alert("Error", "Could not look up farmer. Check your connection.");
      }
    } finally {
      setLoading(false);
    }
  };

  // ─── Manifest / dispatch lookup ───────────────────────────────────────────
  const lookupManifest = async (code: string) => {
    if (!token || loading) return;
    setLoading(true);
    setFarmer(null);
    setDispatch(null);
    try {
      // QR format from web portal: "dispatch:ID:MANIFEST_CODE"
      const dispatchMatch = code.match(/^dispatch:(\d+):(.+)$/);
      if (dispatchMatch) {
        const id = Number(dispatchMatch[1]);
        // Navigate directly — no extra API call needed
        await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
        setLoading(false);
        router.push(`/distribution/${id}`);
        return;
      }

      // Fallback: search by manifest code text
      const result = await getDispatchByManifestCode(token, code);
      if (result) {
        setDispatch(result);
        await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      } else {
        Alert.alert("Not Found", `No manifest found for "${code}". Check the code and try again.`);
        await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
      }
    } catch {
      Alert.alert("Error", "Could not look up manifest. Check your connection.");
    } finally {
      setLoading(false);
    }
  };

  const handleBarcode = async ({ data }: { data: string }) => {
    if (scanned) return;
    setScanned(true);
    if (scanMode === "farmer") {
      await lookupFarmer(data);
    } else {
      await lookupManifest(data);
    }
    setTimeout(() => setScanned(false), 2000);
  };

  const handleManualSearch = () => {
    const trimmed = manualInput.trim();
    if (!trimmed) return;
    if (scanMode === "farmer") {
      lookupFarmer(trimmed);
    } else {
      lookupManifest(trimmed);
    }
  };

  const handleIssueFarmer = () => {
    if (!farmer) return;
    router.push(
      `/confirm-pod?farmerId=${farmer.id}&farmerName=${encodeURIComponent(farmer.firstName + " " + farmer.lastName)}&farmerCode=${farmer.farmerCode}`
    );
  };

  const handleOpenDispatch = () => {
    if (!dispatch) return;
    router.push(`/distribution/${dispatch.id}`);
  };

  const switchScanMode = (m: ScanMode) => {
    setScanMode(m);
    setFarmer(null);
    setDispatch(null);
    setManualInput("");
  };

  // ── shared camera/manual view builder ─────────────────────────────────────
  const renderCamera = () => {
    const hint = scanMode === "farmer"
      ? "Point at farmer QR code or barcode"
      : "Point at dispatch manifest QR code";

    if (Platform.OS === "web") {
      return (
        <View style={[styles.webCameraPlaceholder, { backgroundColor: colors.muted }]}>
          <Feather name="camera-off" size={48} color={colors.mutedForeground} />
          <Text style={[styles.webCameraText, { color: colors.mutedForeground }]}>
            Camera scanning is available on the mobile app.{"\n"}Use Search mode on web.
          </Text>
          <TouchableOpacity
            style={[styles.switchBtn, { backgroundColor: colors.primary, borderRadius: colors.radius }]}
            onPress={() => setCameraActive(false)}
          >
            <Text style={styles.switchBtnText}>Switch to Search</Text>
          </TouchableOpacity>
        </View>
      );
    }

    if (!camPermission) return <ActivityIndicator color={colors.primary} style={{ marginTop: 64 }} />;

    if (!camPermission.granted) {
      return (
        <View style={[styles.permContainer, { backgroundColor: colors.muted }]}>
          <Feather name="camera-off" size={48} color={colors.mutedForeground} />
          <Text style={[styles.permText, { color: colors.foreground }]}>Camera permission required</Text>
          <TouchableOpacity
            style={[styles.permBtn, { backgroundColor: colors.primary, borderRadius: colors.radius }]}
            onPress={requestCamPermission}
          >
            <Text style={styles.permBtnText}>Grant Access</Text>
          </TouchableOpacity>
        </View>
      );
    }

    if (!CameraView) return null;

    return (
      <View style={styles.cameraWrap}>
        <CameraView
          style={StyleSheet.absoluteFillObject}
          onBarcodeScanned={handleBarcode}
          barcodeScannerSettings={{ barcodeTypes: ["qr", "code128", "code39", "ean13", "ean8"] }}
        />
        <View style={styles.scanOverlay}>
          <View style={[styles.scanFrame, { borderColor: colors.primary }]} />
          <Text style={styles.scanHint}>{hint}</Text>
        </View>
      </View>
    );
  };

  const renderManual = () => (
    <View style={styles.manualContainer}>
      <Text style={[styles.manualLabel, { color: colors.mutedForeground }]}>
        {scanMode === "farmer"
          ? "Enter farmer code, barcode, or name"
          : "Enter manifest code (e.g. MAN-2026-001)"}
      </Text>
      <View style={[styles.manualInput, { backgroundColor: colors.muted, borderColor: colors.border, borderRadius: colors.radius }]}>
        <Feather name="search" size={18} color={colors.mutedForeground} />
        <TextInput
          style={[styles.textInput, { color: colors.foreground }]}
          placeholder={scanMode === "farmer" ? "FRM-... or name" : "MAN-..."}
          placeholderTextColor={colors.mutedForeground}
          value={manualInput}
          onChangeText={setManualInput}
          autoCapitalize="characters"
          returnKeyType="search"
          onSubmitEditing={handleManualSearch}
        />
        {loading && <ActivityIndicator color={colors.primary} size="small" />}
      </View>
      <TouchableOpacity
        style={[styles.searchBtn, { backgroundColor: colors.primary, borderRadius: colors.radius, opacity: loading ? 0.7 : 1 }]}
        onPress={handleManualSearch}
        disabled={loading}
        activeOpacity={0.85}
      >
        <Text style={styles.searchBtnText}>
          {scanMode === "farmer" ? "Look Up Farmer" : "Find Manifest"}
        </Text>
      </TouchableOpacity>
    </View>
  );

  return (
    <View style={[styles.root, { backgroundColor: colors.background }]}>
      {/* Header */}
      <View style={[styles.header, { paddingTop: topPad + 12, backgroundColor: colors.background, borderBottomColor: colors.border }]}>
        <Text style={[styles.title, { color: colors.foreground }]}>Scan / Search</Text>

        {/* Scan mode tabs: Farmer | Manifest */}
        <View style={[styles.modeTabs, { backgroundColor: colors.muted, borderRadius: colors.radius }]}>
          {([
            { key: "farmer",   icon: "user",  label: "Farmer" },
            { key: "manifest", icon: "truck", label: "Manifest" },
          ] as const).map((m) => (
            <TouchableOpacity
              key={m.key}
              style={[
                styles.modeTab,
                { backgroundColor: scanMode === m.key ? colors.primary : "transparent", borderRadius: colors.radius - 2 },
              ]}
              onPress={() => switchScanMode(m.key)}
            >
              <Feather name={m.icon} size={14} color={scanMode === m.key ? "#fff" : colors.mutedForeground} />
              <Text style={[styles.modeTabText, { color: scanMode === m.key ? "#fff" : colors.mutedForeground }]}>
                {m.label}
              </Text>
            </TouchableOpacity>
          ))}
        </View>

        {/* Camera / Search sub-toggle */}
        <View style={[styles.subTabs, { backgroundColor: colors.muted, borderRadius: colors.radius }]}>
          {([
            { key: true,  icon: "camera", label: "Scan" },
            { key: false, icon: "search", label: "Search" },
          ] as const).map((t) => (
            <TouchableOpacity
              key={String(t.key)}
              style={[
                styles.subTab,
                { backgroundColor: cameraActive === t.key ? colors.card : "transparent", borderRadius: colors.radius - 2 },
              ]}
              onPress={() => { setCameraActive(t.key); setFarmer(null); setDispatch(null); }}
            >
              <Feather name={t.icon} size={13} color={cameraActive === t.key ? colors.foreground : colors.mutedForeground} />
              <Text style={[styles.subTabText, { color: cameraActive === t.key ? colors.foreground : colors.mutedForeground }]}>
                {t.label}
              </Text>
            </TouchableOpacity>
          ))}
        </View>
      </View>

      {/* Camera / Search content */}
      {cameraActive ? (
        <View style={styles.cameraContainer}>{renderCamera()}</View>
      ) : (
        renderManual()
      )}

      {/* Loading overlay for camera mode */}
      {loading && cameraActive && (
        <View style={[styles.loadingOverlay, { backgroundColor: colors.background }]}>
          <ActivityIndicator color={colors.primary} size="large" />
          <Text style={[styles.loadingText, { color: colors.mutedForeground }]}>
            {scanMode === "farmer" ? "Looking up farmer…" : "Finding manifest…"}
          </Text>
        </View>
      )}

      {/* Results */}
      {(farmer || dispatch) && (
        <View style={[styles.resultContainer, { borderTopColor: colors.border }]}>
          {farmer && <FarmerResult farmer={farmer} onIssue={handleIssueFarmer} />}
          {dispatch && <ManifestResult dispatch={dispatch} onRecord={handleOpenDispatch} />}
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  header: { paddingHorizontal: 20, paddingBottom: 14, gap: 10, borderBottomWidth: 1 },
  title: { fontSize: 24, fontFamily: "Inter_700Bold" },
  modeTabs: { flexDirection: "row", padding: 3, gap: 3 },
  modeTab: { flex: 1, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6, paddingVertical: 8 },
  modeTabText: { fontSize: 13, fontFamily: "Inter_500Medium" },
  subTabs: { flexDirection: "row", padding: 2, gap: 2 },
  subTab: { flex: 1, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 5, paddingVertical: 6 },
  subTabText: { fontSize: 12, fontFamily: "Inter_400Regular" },
  cameraContainer: { flex: 1 },
  cameraWrap: { flex: 1, position: "relative" },
  scanOverlay: { ...StyleSheet.absoluteFillObject, alignItems: "center", justifyContent: "center", gap: 20 },
  scanFrame: { width: 220, height: 220, borderWidth: 2.5, borderRadius: 16 },
  scanHint: { color: "#ffffff", fontFamily: "Inter_500Medium", fontSize: 13 },
  webCameraPlaceholder: { flex: 1, alignItems: "center", justifyContent: "center", gap: 16, padding: 32 },
  webCameraText: { fontSize: 14, fontFamily: "Inter_400Regular", textAlign: "center", lineHeight: 20 },
  switchBtn: { paddingHorizontal: 20, paddingVertical: 10 },
  switchBtnText: { fontSize: 14, fontFamily: "Inter_600SemiBold", color: "#fff" },
  permContainer: { flex: 1, alignItems: "center", justifyContent: "center", gap: 16, padding: 32 },
  permText: { fontSize: 16, fontFamily: "Inter_600SemiBold" },
  permBtn: { paddingHorizontal: 24, paddingVertical: 12 },
  permBtnText: { fontSize: 14, fontFamily: "Inter_600SemiBold", color: "#fff" },
  manualContainer: { padding: 24, gap: 14 },
  manualLabel: { fontSize: 14, fontFamily: "Inter_400Regular" },
  manualInput: { flexDirection: "row", alignItems: "center", gap: 10, paddingHorizontal: 14, height: 50, borderWidth: 1 },
  textInput: { flex: 1, fontSize: 15, fontFamily: "Inter_400Regular" },
  searchBtn: { height: 50, alignItems: "center", justifyContent: "center" },
  searchBtnText: { fontSize: 15, fontFamily: "Inter_600SemiBold", color: "#fff" },
  loadingOverlay: { position: "absolute", bottom: 0, left: 0, right: 0, alignItems: "center", padding: 20, gap: 8 },
  loadingText: { fontSize: 13, fontFamily: "Inter_400Regular" },
  resultContainer: { padding: 16, borderTopWidth: 1 },
  farmerCard: { flexDirection: "row", alignItems: "center", padding: 14, gap: 12, borderWidth: 1.5 },
  farmerAvatar: { width: 52, height: 52, borderRadius: 26, alignItems: "center", justifyContent: "center" },
  farmerInfo: { flex: 1, gap: 2 },
  farmerName: { fontSize: 15, fontFamily: "Inter_600SemiBold" },
  farmerCode: { fontSize: 12, fontFamily: "Inter_400Regular" },
  farmerMeta: { fontSize: 12, fontFamily: "Inter_400Regular", marginTop: 2 },
  issueBtn: { flexDirection: "row", alignItems: "center", gap: 5, paddingHorizontal: 14, paddingVertical: 8 },
  issueBtnText: { fontSize: 13, fontFamily: "Inter_600SemiBold", color: "#fff" },
});
