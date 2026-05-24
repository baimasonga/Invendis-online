import { Feather } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import { Image } from "expo-image";
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
import {
  farmerByBarcode,
  farmerDisplayName,
  searchFarmers,
  getIdentifyUploadUrl,
  findFarmerByFace,
  uploadPhotoToS3,
  type Farmer,
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

type Mode = "camera" | "photo" | "manual";
type TypeFilter = "all" | "individual" | "group";

const TYPE_OPTIONS: { value: TypeFilter; label: string; icon: string }[] = [
  { value: "all", label: "All", icon: "layers" },
  { value: "individual", label: "Individual", icon: "user" },
  { value: "group", label: "Group", icon: "users" },
];

const MODES: { key: Mode; icon: string; label: string }[] = [
  { key: "camera", icon: "maximize", label: "Scan Barcode" },
  { key: "photo",  icon: "aperture", label: "Photo ID"     },
  { key: "manual", icon: "search",   label: "Manual Search" },
];

export default function ScanFarmerScreen() {
  const { dispatchId } = useLocalSearchParams<{ dispatchId?: string }>();
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const { token } = useAuth();
  const router = useRouter();

  const [mode, setMode] = useState<Mode>("camera");
  const [typeFilter, setTypeFilter] = useState<TypeFilter>("all");
  const [input, setInput] = useState("");
  const [farmer, setFarmer] = useState<Farmer | null>(null);
  const [faceSimilarity, setFaceSimilarity] = useState<number | null>(null);
  const [searchResults, setSearchResults] = useState<Farmer[]>([]);
  const [loading, setLoading] = useState(false);
  const [scanned, setScanned] = useState(false);

  // Photo ID state
  const [photoUri, setPhotoUri] = useState<string | null>(null);
  const [identifying, setIdentifying] = useState(false);
  const [identifyError, setIdentifyError] = useState<string | null>(null);

  const camPerms = useCameraPermissions ? useCameraPermissions() : ([null, async () => {}] as [{ granted: boolean } | null, () => Promise<void>]);
  const [camPermission, requestCamPermission] = camPerms;
  const bottomPad = Platform.OS === "web" ? 34 : insets.bottom;

  const getFilters = () =>
    typeFilter !== "all" ? { beneficiaryType: typeFilter as "individual" | "group" } : undefined;

  const clearResult = () => { setFarmer(null); setSearchResults([]); setFaceSimilarity(null); };

  const lookup = async (code: string) => {
    if (!token || loading) return;
    setLoading(true);
    clearResult();
    try {
      const result = await farmerByBarcode(token, code);
      const filters = getFilters();
      if (filters?.beneficiaryType && result.beneficiaryType !== filters.beneficiaryType) {
        Alert.alert(
          "Type Mismatch",
          `This farmer is registered as "${result.beneficiaryType ?? "unknown"}" but your filter is set to "${typeFilter}". Showing result anyway.`
        );
      }
      setFarmer(result);
      await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    } catch {
      const results = await searchFarmers(token, code, getFilters()).catch(() => ({ data: [] as Farmer[] }));
      if (results.data.length === 1) {
        setFarmer(results.data[0]);
        await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      } else if (results.data.length > 1) {
        setSearchResults(results.data);
        await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      } else {
        Alert.alert("Not Found", "No farmer found matching that code or name" + (typeFilter !== "all" ? ` (filtered to ${typeFilter})` : "") + ".");
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

  const handlePhotoCapture = async () => {
    if (Platform.OS === "web") {
      Alert.alert("Not Available", "Photo identification is only available on the mobile app.");
      return;
    }
    const uri = await takeCameraPhoto();
    if (!uri || !token) return;

    setPhotoUri(uri);
    setIdentifying(true);
    setIdentifyError(null);
    clearResult();

    try {
      const uploadInfo = await getIdentifyUploadUrl(token);
      await uploadPhotoToS3(uploadInfo.uploadUrl, uri);
      const match = await findFarmerByFace(token, uploadInfo.key);
      if (match.farmer) {
        setFarmer(match.farmer as unknown as Farmer);
        setFaceSimilarity(match.similarity ?? null);
        await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      } else {
        setIdentifyError("No matching farmer found. Try scanning their barcode or use manual search.");
        await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
      }
    } catch (e: any) {
      setIdentifyError(e?.message ?? "Face identification failed. Please try again.");
    } finally {
      setIdentifying(false);
    }
  };

  const handleConfirm = () => {
    if (!farmer) return;
    const isGroup = farmer.beneficiaryType === "group";
    const params = new URLSearchParams({
      farmerId: String(farmer.id),
      farmerName: farmerDisplayName(farmer),
      farmerCode: farmer.farmerCode,
      beneficiaryType: farmer.beneficiaryType ?? "individual",
      ...(isGroup ? { contactName: `${farmer.firstName} ${farmer.lastName}` } : {}),
      ...(farmer.groupSize != null ? { groupSize: String(farmer.groupSize) } : {}),
      ...(dispatchId ? { dispatchId } : {}),
    });
    router.push(`/confirm-pod?${params.toString()}`);
  };

  const switchMode = (m: Mode) => {
    setMode(m);
    clearResult();
    setPhotoUri(null);
    setIdentifyError(null);
  };

  return (
    <View style={[styles.root, { backgroundColor: colors.background }]}>
      {/* Mode tabs */}
      <View style={[styles.modeSwitcher, { borderBottomColor: colors.border, backgroundColor: colors.background }]}>
        {MODES.map((m) => (
          <TouchableOpacity
            key={m.key}
            style={[styles.modeBtn, m.key === mode && { borderBottomColor: colors.primary, borderBottomWidth: 2 }]}
            onPress={() => switchMode(m.key)}
          >
            <Feather name={m.icon as any} size={15} color={m.key === mode ? colors.primary : colors.mutedForeground} />
            <Text style={[styles.modeBtnText, { color: m.key === mode ? colors.primary : colors.mutedForeground }]}>
              {m.label}
            </Text>
          </TouchableOpacity>
        ))}
      </View>

      {/* Type filter (barcode + manual only) */}
      {mode !== "photo" && (
        <View style={[styles.typeRow, { borderBottomColor: colors.border, backgroundColor: colors.muted }]}>
          <Text style={[styles.typeLabel, { color: colors.mutedForeground }]}>Type:</Text>
          <View style={[styles.typeToggle, { backgroundColor: colors.background, borderColor: colors.border }]}>
            {TYPE_OPTIONS.map((opt) => {
              const active = typeFilter === opt.value;
              return (
                <TouchableOpacity
                  key={opt.value}
                  style={[styles.typeOption, active && { backgroundColor: colors.primary }]}
                  onPress={() => { setTypeFilter(opt.value); clearResult(); }}
                  activeOpacity={0.8}
                >
                  <Feather name={opt.icon as any} size={12} color={active ? "#fff" : colors.mutedForeground} />
                  <Text style={[styles.typeOptionText, { color: active ? "#fff" : colors.mutedForeground }]}>
                    {opt.label}
                  </Text>
                </TouchableOpacity>
              );
            })}
          </View>
        </View>
      )}

      {/* ── Barcode camera ─────────────────────────────────────────── */}
      {mode === "camera" && (
        <View style={styles.cameraArea}>
          {Platform.OS === "web" || !CameraView ? (
            <View style={[styles.camUnavail, { backgroundColor: colors.muted }]}>
              <Feather name="camera-off" size={40} color={colors.mutedForeground} />
              <Text style={[styles.camUnavailText, { color: colors.mutedForeground }]}>Camera not available on web</Text>
              <TouchableOpacity style={[styles.switchBtn, { backgroundColor: colors.primary, borderRadius: colors.radius }]} onPress={() => switchMode("manual")}>
                <Text style={styles.switchBtnTxt}>Switch to Search</Text>
              </TouchableOpacity>
            </View>
          ) : !camPermission ? (
            <ActivityIndicator color={colors.primary} style={{ marginTop: 64 }} />
          ) : !camPermission.granted ? (
            <View style={[styles.camUnavail, { backgroundColor: colors.muted }]}>
              <Feather name="lock" size={40} color={colors.mutedForeground} />
              <Text style={[styles.camUnavailText, { color: colors.foreground }]}>Camera permission needed</Text>
              <TouchableOpacity style={[styles.switchBtn, { backgroundColor: colors.primary, borderRadius: colors.radius }]} onPress={requestCamPermission}>
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
                {typeFilter !== "all" && (
                  <View style={[styles.filterBadge, { backgroundColor: colors.primary }]}>
                    <Feather name={typeFilter === "group" ? "users" : "user"} size={11} color="#fff" />
                    <Text style={styles.filterBadgeText}>{typeFilter === "group" ? "Groups only" : "Individuals only"}</Text>
                  </View>
                )}
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
      )}

      {/* ── Photo identification ───────────────────────────────────── */}
      {mode === "photo" && (
        <View style={[styles.photoArea, { backgroundColor: colors.background }]}>
          {Platform.OS === "web" ? (
            <View style={[styles.camUnavail, { backgroundColor: colors.muted, flex: 0, borderRadius: colors.radius, padding: 32, margin: 24 }]}>
              <Feather name="camera-off" size={40} color={colors.mutedForeground} />
              <Text style={[styles.camUnavailText, { color: colors.mutedForeground }]}>
                Photo identification is only available on the mobile app.
              </Text>
            </View>
          ) : (
            <>
              {/* Photo preview / placeholder */}
              {photoUri ? (
                <View style={[styles.photoPreviewWrap, { borderRadius: colors.radius, borderColor: colors.border }]}>
                  <Image source={{ uri: photoUri }} style={styles.photoPreview} contentFit="cover" />
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
                    Take a photo of the farmer to identify them by face
                  </Text>
                </View>
              )}

              {/* Error */}
              {identifyError && (
                <View style={[styles.identifyError, { backgroundColor: colors.destructive + "18", borderColor: colors.destructive + "40", borderRadius: colors.radius }]}>
                  <Feather name="alert-circle" size={16} color={colors.destructive} />
                  <Text style={[styles.identifyErrorText, { color: colors.destructive }]}>{identifyError}</Text>
                </View>
              )}

              {/* Capture button */}
              <TouchableOpacity
                style={[styles.captureBtn, { backgroundColor: colors.primary, borderRadius: colors.radius, opacity: identifying ? 0.6 : 1 }]}
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
                The farmer must have a registered reference photo for face matching to work.
              </Text>
            </>
          )}
        </View>
      )}

      {/* ── Manual search ──────────────────────────────────────────── */}
      {mode === "manual" && (
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

      {/* ── Multi-result list ──────────────────────────────────────── */}
      {searchResults.length > 1 && (
        <View style={[styles.farmerPanel, { borderTopColor: colors.border, paddingBottom: bottomPad + 16, backgroundColor: colors.background }]}>
          <Text style={[styles.resultsHeader, { color: colors.mutedForeground }]}>
            {searchResults.length} farmers found — tap to select
          </Text>
          {searchResults.map((r) => (
            <TouchableOpacity
              key={r.id}
              style={[styles.farmerCard, { backgroundColor: colors.card, borderColor: colors.border, borderRadius: colors.radius }]}
              onPress={() => { setFarmer(r); setSearchResults([]); }}
              activeOpacity={0.8}
            >
              <View style={[styles.avatar, { backgroundColor: colors.primary + "18" }]}>
                <Feather name={r.beneficiaryType === "group" ? "users" : "user"} size={22} color={colors.primary} />
              </View>
              <View style={styles.farmerDetails}>
                <Text style={[styles.farmerName, { color: colors.foreground }]}>{farmerDisplayName(r)}</Text>
                {r.beneficiaryType === "group" && (
                  <Text style={[styles.farmerContact, { color: colors.mutedForeground }]}>Contact: {r.firstName} {r.lastName}</Text>
                )}
                <Text style={[styles.farmerCode, { color: colors.mutedForeground }]}>{r.farmerCode}</Text>
                {r.phone && <Text style={[styles.farmerPhone, { color: colors.mutedForeground }]}>{r.phone}</Text>}
              </View>
              <Feather name="chevron-right" size={18} color={colors.mutedForeground} />
            </TouchableOpacity>
          ))}
        </View>
      )}

      {/* ── Single farmer result ───────────────────────────────────── */}
      {farmer && (
        <View style={[styles.farmerPanel, { borderTopColor: colors.border, paddingBottom: bottomPad + 16, backgroundColor: colors.background }]}>
          <View style={[styles.farmerCard, { backgroundColor: colors.card, borderColor: colors.primary + "40", borderRadius: colors.radius }]}>
            <View style={[styles.avatar, { backgroundColor: colors.primary + "18" }]}>
              <Feather name={farmer.beneficiaryType === "group" ? "users" : "user"} size={28} color={colors.primary} />
            </View>
            <View style={styles.farmerDetails}>
              <Text style={[styles.farmerName, { color: colors.foreground }]}>{farmerDisplayName(farmer)}</Text>
              {farmer.beneficiaryType === "group" && (
                <Text style={[styles.farmerContact, { color: colors.mutedForeground }]}>Contact: {farmer.firstName} {farmer.lastName}</Text>
              )}
              <Text style={[styles.farmerCode, { color: colors.mutedForeground }]}>{farmer.farmerCode}</Text>
              {faceSimilarity != null && (
                <Text style={[styles.farmerPhone, { color: colors.success ?? "#22c55e" }]}>
                  <Feather name="check-circle" size={11} /> {faceSimilarity}% face match
                </Text>
              )}
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
  modeBtn: { flex: 1, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6, paddingVertical: 13 },
  modeBtnText: { fontSize: 12, fontFamily: "Inter_500Medium" },
  typeRow: { flexDirection: "row", alignItems: "center", paddingHorizontal: 16, paddingVertical: 10, gap: 10, borderBottomWidth: 1 },
  typeLabel: { fontSize: 13, fontFamily: "Inter_500Medium" },
  typeToggle: { flexDirection: "row", borderWidth: 1, borderRadius: 8, overflow: "hidden" },
  typeOption: { flexDirection: "row", alignItems: "center", gap: 5, paddingHorizontal: 12, paddingVertical: 7 },
  typeOptionText: { fontSize: 12, fontFamily: "Inter_500Medium" },
  // Barcode camera
  cameraArea: { flex: 1 },
  cameraWrap: { flex: 1 },
  overlay: { ...StyleSheet.absoluteFillObject, alignItems: "center", justifyContent: "center", gap: 16 },
  frame: { width: 220, height: 220, borderWidth: 2.5, borderRadius: 16 },
  hint: { color: "#fff", fontFamily: "Inter_500Medium", fontSize: 13 },
  filterBadge: { flexDirection: "row", alignItems: "center", gap: 5, paddingHorizontal: 12, paddingVertical: 6, borderRadius: 20 },
  filterBadgeText: { color: "#fff", fontFamily: "Inter_500Medium", fontSize: 12 },
  scanningBanner: { position: "absolute", bottom: 32, left: 32, right: 32, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 10, padding: 12, borderRadius: 12 },
  scanningText: { color: "#fff", fontFamily: "Inter_500Medium", fontSize: 14 },
  camUnavail: { flex: 1, alignItems: "center", justifyContent: "center", gap: 16, padding: 32 },
  camUnavailText: { fontSize: 15, fontFamily: "Inter_400Regular", textAlign: "center" },
  switchBtn: { paddingHorizontal: 24, paddingVertical: 12 },
  switchBtnTxt: { color: "#fff", fontFamily: "Inter_600SemiBold", fontSize: 14 },
  // Photo ID
  photoArea: { flex: 1, padding: 16, gap: 14 },
  photoPreviewWrap: { flex: 1, borderWidth: 1, overflow: "hidden", maxHeight: 340 },
  photoPreview: { width: "100%", height: "100%" },
  photoOverlay: { ...StyleSheet.absoluteFillObject, backgroundColor: "rgba(0,0,0,0.55)", alignItems: "center", justifyContent: "center", gap: 12 },
  photoOverlayText: { color: "#fff", fontFamily: "Inter_500Medium", fontSize: 15 },
  photoPlaceholder: { flex: 1, maxHeight: 280, borderWidth: 1.5, borderStyle: "dashed", alignItems: "center", justifyContent: "center", gap: 12, padding: 32 },
  photoPlaceholderText: { fontSize: 14, fontFamily: "Inter_400Regular", textAlign: "center" },
  identifyError: { flexDirection: "row", alignItems: "flex-start", gap: 8, padding: 12, borderWidth: 1 },
  identifyErrorText: { flex: 1, fontSize: 13, fontFamily: "Inter_400Regular", lineHeight: 18 },
  captureBtn: { height: 52, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8 },
  captureBtnText: { fontSize: 15, fontFamily: "Inter_600SemiBold", color: "#fff" },
  photoHint: { fontSize: 12, fontFamily: "Inter_400Regular", textAlign: "center" },
  // Manual search
  manualArea: { padding: 24, gap: 14 },
  input: { height: 50, paddingHorizontal: 14, fontSize: 15, fontFamily: "Inter_400Regular", borderWidth: 1 },
  lookupBtn: { height: 50, alignItems: "center", justifyContent: "center" },
  lookupBtnTxt: { color: "#fff", fontFamily: "Inter_600SemiBold", fontSize: 15 },
  // Results
  farmerPanel: { padding: 16, gap: 12, borderTopWidth: 1 },
  farmerCard: { flexDirection: "row", alignItems: "center", padding: 14, gap: 12, borderWidth: 1.5 },
  avatar: { width: 52, height: 52, borderRadius: 26, alignItems: "center", justifyContent: "center" },
  farmerDetails: { flex: 1, gap: 3 },
  resultsHeader: { fontSize: 12, fontFamily: "Inter_400Regular", marginBottom: 4 },
  farmerName: { fontSize: 16, fontFamily: "Inter_600SemiBold" },
  farmerContact: { fontSize: 12, fontFamily: "Inter_400Regular" },
  farmerCode: { fontSize: 12, fontFamily: "Inter_400Regular" },
  farmerPhone: { fontSize: 12, fontFamily: "Inter_400Regular" },
  confirmBtn: { height: 52, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 10 },
  confirmBtnTxt: { color: "#fff", fontFamily: "Inter_600SemiBold", fontSize: 15 },
});
