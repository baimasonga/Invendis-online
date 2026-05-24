import { Feather } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import { Image } from "expo-image";
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
  farmerDisplayName,
  searchFarmers,
  getDispatchByManifestCode,
  getIdentifyUploadUrl,
  findFarmerByFace,
  uploadPhotoToS3,
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

async function takeCameraPhoto(): Promise<string | null> {
  if (Platform.OS === "web") return null;
  try {
    const ImagePicker = require("expo-image-picker");
    const { status } = await ImagePicker.requestCameraPermissionsAsync();
    if (status !== "granted") {
      Alert.alert("Permission Required", "Camera access is needed to take a photo.");
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

type ScanMode = "farmer" | "manifest";
type ViewMode = "scan" | "photo" | "search";

function FarmerResult({
  farmer,
  similarity,
  onIssue,
}: {
  farmer: Farmer;
  similarity?: number | null;
  onIssue: () => void;
}) {
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
        {similarity != null && (
          <Text style={[styles.farmerMeta, { color: colors.success }]}>
            <Feather name="check-circle" size={11} /> {similarity}% face match
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
  const [viewMode, setViewMode] = useState<ViewMode>("scan");
  const [manualInput, setManualInput] = useState("");
  const [farmer, setFarmer] = useState<Farmer | null>(null);
  const [faceSimilarity, setFaceSimilarity] = useState<number | null>(null);
  const [dispatch, setDispatch] = useState<Dispatch | null>(null);
  const [loading, setLoading] = useState(false);
  const [scanned, setScanned] = useState(false);

  // Photo identification state
  const [photoUri, setPhotoUri] = useState<string | null>(null);
  const [identifying, setIdentifying] = useState(false);
  const [identifyError, setIdentifyError] = useState<string | null>(null);

  const camPerms = useCameraPermissions ? useCameraPermissions() : ([null, async () => {}] as [{ granted: boolean } | null, () => Promise<void>]);
  const [camPermission, requestCamPermission] = camPerms;

  const topPad = Platform.OS === "web" ? 67 : insets.top;

  const clearResults = () => {
    setFarmer(null);
    setDispatch(null);
    setFaceSimilarity(null);
    setPhotoUri(null);
    setIdentifyError(null);
  };

  // ─── Farmer lookup ────────────────────────────────────────────────────────
  const lookupFarmer = async (code: string) => {
    if (!token || loading) return;
    setLoading(true);
    clearResults();
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
    clearResults();
    try {
      const dispatchMatch = code.match(/^dispatch:(\d+):(.+)$/);
      if (dispatchMatch) {
        const id = Number(dispatchMatch[1]);
        await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
        setLoading(false);
        router.push(`/distribution/${id}`);
        return;
      }
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

  // ─── Face photo identification ─────────────────────────────────────────────
  const handlePhotoCapture = async () => {
    if (!token) return;
    clearResults();
    setIdentifyError(null);

    if (Platform.OS === "web") {
      Alert.alert("Not Available", "Photo identification is only available on the mobile app.");
      return;
    }

    const uri = await takeCameraPhoto();
    if (!uri) return;

    setPhotoUri(uri);
    setIdentifying(true);
    try {
      const uploadInfo = await getIdentifyUploadUrl(token);
      await uploadPhotoToS3(uploadInfo.uploadUrl, uri);
      const result = await findFarmerByFace(token, uploadInfo.key);
      if (result.matched && result.farmer) {
        setFarmer(result.farmer as Farmer);
        setFaceSimilarity(result.similarity);
        await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      } else {
        setIdentifyError(
          result.reason === "no_reference_photos"
            ? "No farmers have reference photos registered yet."
            : "No matching farmer found. Try scanning their QR code or use Search."
        );
        await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
      }
    } catch (e) {
      setIdentifyError(e instanceof Error ? e.message : "Identification failed. Check your connection.");
    } finally {
      setIdentifying(false);
    }
  };

  const handleIssueFarmer = () => {
    if (!farmer) return;
    const params = new URLSearchParams({
      farmerId: String(farmer.id),
      farmerName: farmerDisplayName(farmer),
      farmerCode: farmer.farmerCode,
      beneficiaryType: farmer.beneficiaryType ?? "individual",
      ...(farmer.groupSize != null ? { groupSize: String(farmer.groupSize) } : {}),
    });
    router.push(`/confirm-pod?${params.toString()}`);
  };

  const handleOpenDispatch = () => {
    if (!dispatch) return;
    router.push(`/distribution/${dispatch.id}`);
  };

  const switchScanMode = (m: ScanMode) => {
    setScanMode(m);
    clearResults();
    setManualInput("");
    // Photo tab only available in farmer mode
    if (m === "manifest" && viewMode === "photo") setViewMode("scan");
  };

  const switchViewMode = (m: ViewMode) => {
    setViewMode(m);
    clearResults();
    setManualInput("");
  };

  // ── Sub-tab definitions ────────────────────────────────────────────────────
  const farmerSubTabs = [
    { key: "scan"   as ViewMode, icon: "camera" as const,     label: "Scan"   },
    { key: "photo"  as ViewMode, icon: "aperture" as const,   label: "Photo"  },
    { key: "search" as ViewMode, icon: "search" as const,     label: "Search" },
  ];
  const manifestSubTabs = [
    { key: "scan"   as ViewMode, icon: "camera" as const,     label: "Scan"   },
    { key: "search" as ViewMode, icon: "search" as const,     label: "Search" },
  ];
  const subTabs = scanMode === "farmer" ? farmerSubTabs : manifestSubTabs;

  // ── Camera view ────────────────────────────────────────────────────────────
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
            onPress={() => switchViewMode("search")}
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

  // ── Photo identification view ──────────────────────────────────────────────
  const renderPhoto = () => {
    if (Platform.OS === "web") {
      return (
        <View style={[styles.photoContainer, { backgroundColor: colors.background }]}>
          <View style={[styles.webCameraPlaceholder, { backgroundColor: colors.muted, flex: 0, borderRadius: colors.radius, padding: 32 }]}>
            <Feather name="camera-off" size={40} color={colors.mutedForeground} />
            <Text style={[styles.webCameraText, { color: colors.mutedForeground }]}>
              Photo identification is only available on the mobile app.
            </Text>
          </View>
        </View>
      );
    }

    return (
      <View style={[styles.photoContainer, { backgroundColor: colors.background }]}>
        {/* Preview of captured photo */}
        {photoUri ? (
          <View style={[styles.photoPreviewWrap, { borderRadius: colors.radius, borderColor: colors.border }]}>
            <Image
              source={{ uri: photoUri }}
              style={styles.photoPreview}
              contentFit="cover"
            />
            {identifying && (
              <View style={styles.photoOverlay}>
                <ActivityIndicator color="#fff" size="large" />
                <Text style={styles.photoOverlayText}>Identifying farmer…</Text>
              </View>
            )}
          </View>
        ) : (
          <View style={[styles.photoPlaceholder, { backgroundColor: colors.muted, borderColor: colors.border, borderRadius: colors.radius }]}>
            <Feather name="user" size={56} color={colors.mutedForeground} />
            <Text style={[styles.photoPlaceholderText, { color: colors.mutedForeground }]}>
              Take a photo of the farmer to identify them using face recognition
            </Text>
          </View>
        )}

        {/* Error message */}
        {identifyError && (
          <View style={[styles.identifyError, { backgroundColor: colors.destructive + "18", borderColor: colors.destructive + "40", borderRadius: colors.radius }]}>
            <Feather name="alert-circle" size={16} color={colors.destructive} />
            <Text style={[styles.identifyErrorText, { color: colors.destructive }]}>{identifyError}</Text>
          </View>
        )}

        {/* Action buttons */}
        <TouchableOpacity
          style={[
            styles.captureBtn,
            { backgroundColor: colors.primary, borderRadius: colors.radius, opacity: identifying ? 0.6 : 1 },
          ]}
          onPress={handlePhotoCapture}
          disabled={identifying}
          activeOpacity={0.85}
        >
          <Feather name="camera" size={18} color="#fff" />
          <Text style={styles.captureBtnText}>
            {photoUri ? "Retake Photo" : "Take Photo"}
          </Text>
        </TouchableOpacity>

        <Text style={[styles.photoHint, { color: colors.mutedForeground }]}>
          The farmer must have a registered reference photo for this to work.
        </Text>
      </View>
    );
  };

  // ── Manual search view ────────────────────────────────────────────────────
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

        {/* View mode sub-tabs */}
        <View style={[styles.subTabs, { backgroundColor: colors.muted, borderRadius: colors.radius }]}>
          {subTabs.map((t) => (
            <TouchableOpacity
              key={t.key}
              style={[
                styles.subTab,
                { backgroundColor: viewMode === t.key ? colors.card : "transparent", borderRadius: colors.radius - 2 },
              ]}
              onPress={() => switchViewMode(t.key)}
            >
              <Feather name={t.icon} size={13} color={viewMode === t.key ? colors.foreground : colors.mutedForeground} />
              <Text style={[styles.subTabText, { color: viewMode === t.key ? colors.foreground : colors.mutedForeground }]}>
                {t.label}
              </Text>
            </TouchableOpacity>
          ))}
        </View>
      </View>

      {/* Content */}
      {viewMode === "scan" ? (
        <View style={styles.cameraContainer}>{renderCamera()}</View>
      ) : viewMode === "photo" ? (
        renderPhoto()
      ) : (
        renderManual()
      )}

      {/* Loading overlay for barcode scan mode */}
      {loading && viewMode === "scan" && (
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
          {farmer && (
            <FarmerResult
              farmer={farmer}
              similarity={faceSimilarity}
              onIssue={handleIssueFarmer}
            />
          )}
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
  // Photo identification
  photoContainer: { flex: 1, padding: 20, gap: 16 },
  photoPreviewWrap: { width: "100%", aspectRatio: 3 / 4, maxHeight: 340, borderWidth: 1, overflow: "hidden", alignSelf: "center" },
  photoPreview: { width: "100%", height: "100%" },
  photoOverlay: { ...StyleSheet.absoluteFillObject, backgroundColor: "rgba(0,0,0,0.55)", alignItems: "center", justifyContent: "center", gap: 12 },
  photoOverlayText: { color: "#fff", fontFamily: "Inter_500Medium", fontSize: 14 },
  photoPlaceholder: { width: "100%", aspectRatio: 3 / 4, maxHeight: 280, borderWidth: 1.5, borderStyle: "dashed", alignItems: "center", justifyContent: "center", gap: 14, padding: 24, alignSelf: "center" },
  photoPlaceholderText: { fontSize: 13, fontFamily: "Inter_400Regular", textAlign: "center", lineHeight: 18, maxWidth: 220 },
  identifyError: { flexDirection: "row", alignItems: "flex-start", gap: 8, padding: 12, borderWidth: 1 },
  identifyErrorText: { flex: 1, fontSize: 13, fontFamily: "Inter_400Regular", lineHeight: 18 },
  captureBtn: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8, height: 50 },
  captureBtnText: { fontSize: 15, fontFamily: "Inter_600SemiBold", color: "#fff" },
  photoHint: { fontSize: 12, fontFamily: "Inter_400Regular", textAlign: "center" },
  // Manual search
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
