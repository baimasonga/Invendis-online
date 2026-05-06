import { Feather } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import { useQuery } from "@tanstack/react-query";
import { useLocalSearchParams, useRouter } from "expo-router";
import React, { useCallback, useEffect, useRef } from "react";
import {
  ActivityIndicator,
  Alert,
  Platform,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { StatusBadge } from "@/components/StatusBadge";
import { EmptyState } from "@/components/EmptyState";
import { useAuth } from "@/context/AuthContext";
import { useColors } from "@/hooks/useColors";
import { getDispatch, listPoDs, pingGps } from "@/lib/api";

// ── GPS helper ────────────────────────────────────────────────────────────────

async function getCurrentLocation(): Promise<{ latitude: number; longitude: number } | null> {
  if (Platform.OS === "web") {
    return new Promise((resolve) => {
      if (!navigator.geolocation) { resolve(null); return; }
      navigator.geolocation.getCurrentPosition(
        (p) => resolve({ latitude: p.coords.latitude, longitude: p.coords.longitude }),
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
    return { latitude: pos.coords.latitude, longitude: pos.coords.longitude };
  } catch {
    return null;
  }
}

// ── GPS status mini-badge ─────────────────────────────────────────────────────

function GpsStatusPill({ status }: { status: string | null | undefined }) {
  const colors = useColors();
  if (!status || status === "Pending") return null;
  const map: Record<string, { color: string; label: string; icon: keyof typeof Feather.glyphMap }> = {
    Verified:   { color: colors.success,         label: "GPS ✓",  icon: "map-pin"       },
    Mismatch:   { color: colors.warning,          label: "GPS ⚠",  icon: "alert-triangle" },
    NoLocation: { color: colors.mutedForeground,  label: "No GPS", icon: "wifi-off"      },
  };
  const cfg = map[status] ?? { color: colors.mutedForeground, label: status, icon: "map-pin" as const };
  return (
    <View style={[pill.wrap, { backgroundColor: cfg.color + "20", borderRadius: 4 }]}>
      <Feather name={cfg.icon} size={9} color={cfg.color} />
      <Text style={[pill.text, { color: cfg.color }]}>{cfg.label}</Text>
    </View>
  );
}

const pill = StyleSheet.create({
  wrap: { flexDirection: "row", alignItems: "center", gap: 3, paddingHorizontal: 6, paddingVertical: 2 },
  text: { fontSize: 9, fontFamily: "Inter_600SemiBold" },
});

// ── Main Screen ───────────────────────────────────────────────────────────────

export default function DistributionDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const { token } = useAuth();
  const router = useRouter();
  const dispatchId = Number(id);

  const hasArrivedRef = useRef(false);
  const pingIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const dispatchQ = useQuery({
    queryKey: ["dispatch", dispatchId],
    queryFn: () => getDispatch(token!, dispatchId),
    enabled: !!token && !!dispatchId,
  });

  const podsQ = useQuery({
    queryKey: ["pods", dispatchId],
    queryFn: () => listPoDs(token!, { dispatchId: String(dispatchId), limit: "50" }),
    enabled: !!token && !!dispatchId,
  });

  const dispatch = dispatchQ.data;
  const pods = podsQ.data?.data ?? [];
  const bottomPad = Platform.OS === "web" ? 34 : insets.bottom;

  // ── GPS ping logic ──────────────────────────────────────────────────────────
  const doPing = useCallback(async () => {
    if (!token || !dispatch?.vehicleId || dispatch?.status !== "In Transit" || hasArrivedRef.current) return;
    const location = await getCurrentLocation();
    if (!location) return;
    try {
      const result = await pingGps(token, dispatch.vehicleId, location.latitude, location.longitude, {
        dispatchId: dispatch.id,
      });
      if (result.arrivalStatus === "arrived" && !hasArrivedRef.current) {
        hasArrivedRef.current = true;
        await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
        Alert.alert(
          "Arrived at Destination! 🎯",
          "The vehicle has entered the delivery zone. This dispatch has been marked as Arrived.",
          [{ text: "OK", onPress: () => dispatchQ.refetch() }]
        );
      }
    } catch {
      // ping is best-effort — silent fail
    }
  }, [token, dispatch]);

  useEffect(() => {
    if (dispatch?.status !== "In Transit" || !dispatch?.vehicleId) return;
    hasArrivedRef.current = false;
    doPing(); // immediate first ping
    pingIntervalRef.current = setInterval(doPing, 120_000); // every 2 min
    return () => {
      if (pingIntervalRef.current) clearInterval(pingIntervalRef.current);
    };
  }, [dispatch?.status, dispatch?.vehicleId, doPing]);

  // ── Loading / error states ──────────────────────────────────────────────────
  if (dispatchQ.isLoading) {
    return (
      <View style={[styles.center, { backgroundColor: colors.background }]}>
        <ActivityIndicator color={colors.primary} />
      </View>
    );
  }

  if (!dispatch) {
    return (
      <View style={[styles.center, { backgroundColor: colors.background }]}>
        <EmptyState icon="alert-circle" title="Dispatch not found" />
      </View>
    );
  }

  const isInTransit = dispatch.status === "In Transit" || dispatch.status === "InTransit";
  const isArrived   = dispatch.status === "Arrived" || !!dispatch.arrivedAt;

  return (
    <ScrollView
      style={[styles.root, { backgroundColor: colors.background }]}
      contentContainerStyle={[styles.content, { paddingBottom: bottomPad + 120 }]}
      refreshControl={
        <RefreshControl
          refreshing={dispatchQ.isLoading}
          onRefresh={() => { dispatchQ.refetch(); podsQ.refetch(); }}
          tintColor={colors.primary}
        />
      }
    >
      {/* Dispatch info card */}
      <View style={[styles.infoCard, { backgroundColor: colors.primary }]}>
        <View style={styles.infoRow}>
          <Text style={styles.manifestLabel}>Manifest</Text>
          <StatusBadge status={dispatch.status} />
        </View>
        <Text style={styles.manifestCode}>{dispatch.manifestCode}</Text>
        <Text style={styles.destination}>
          {dispatch.destinationCommunity ?? dispatch.destinationDistrict ?? "—"}
        </Text>
        <View style={styles.metaRow}>
          <View style={styles.metaItem}>
            <Feather name="package" size={13} color="rgba(255,255,255,0.7)" />
            <Text style={styles.metaText}>{dispatch.totalPackages ?? 0} packages</Text>
          </View>
          {dispatch.departedAt && (
            <View style={styles.metaItem}>
              <Feather name="clock" size={13} color="rgba(255,255,255,0.7)" />
              <Text style={styles.metaText}>{new Date(dispatch.departedAt).toLocaleDateString()}</Text>
            </View>
          )}
          {dispatch.arrivedAt && (
            <View style={styles.metaItem}>
              <Feather name="check-circle" size={13} color="rgba(255,255,255,0.9)" />
              <Text style={[styles.metaText, { color: "rgba(255,255,255,0.95)", fontFamily: "Inter_600SemiBold" }]}>
                Arrived {new Date(dispatch.arrivedAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
              </Text>
            </View>
          )}
        </View>
      </View>

      {/* Arrival banner */}
      {isArrived && (
        <View style={[styles.arrivedBanner, { backgroundColor: colors.success + "18", borderColor: colors.success + "40" }]}>
          <View style={[styles.arrivedIcon, { backgroundColor: colors.success + "25" }]}>
            <Feather name="check-circle" size={20} color={colors.success} />
          </View>
          <View style={{ flex: 1 }}>
            <Text style={[styles.arrivedTitle, { color: colors.success }]}>Destination Reached</Text>
            <Text style={[styles.arrivedSub, { color: colors.success }]}>
              Vehicle confirmed within the delivery zone.
              {dispatch.arrivedAt ? ` Arrived ${new Date(dispatch.arrivedAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}.` : ""}
            </Text>
          </View>
        </View>
      )}

      {/* Active GPS tracking banner */}
      {isInTransit && !isArrived && dispatch.vehicleId && (
        <View style={[styles.gpsBanner, { backgroundColor: colors.info + "14", borderColor: colors.info + "30" }]}>
          <View style={[styles.gpsIconWrap, { backgroundColor: colors.info + "20" }]}>
            <Feather name="navigation" size={16} color={colors.info} />
          </View>
          <View style={{ flex: 1 }}>
            <Text style={[styles.gpsBannerTitle, { color: colors.info }]}>GPS Tracking Active</Text>
            <Text style={[styles.gpsBannerSub, { color: colors.info }]}>Pinging every 2 min · Arrival auto-detected</Text>
          </View>
          <View style={[styles.gpsDot, { backgroundColor: colors.info }]} />
        </View>
      )}

      {/* Items loaded */}
      {dispatch.items && dispatch.items.length > 0 && (
        <View>
          <Text style={[styles.sectionTitle, { color: colors.foreground }]}>Items on Manifest</Text>
          {dispatch.items.map((item) => (
            <View key={item.id} style={[styles.itemRow, { backgroundColor: colors.card, borderColor: colors.border, borderRadius: colors.radius }]}>
              <View style={[styles.itemIcon, { backgroundColor: colors.muted }]}>
                <Feather name="box" size={16} color={colors.primary} />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={[styles.itemName, { color: colors.foreground }]}>{item.inputItemName ?? `Item #${item.inputItemId}`}</Text>
                <Text style={[styles.itemQty, { color: colors.mutedForeground }]}>
                  {item.quantityLoaded ?? 0} {item.unit ?? "units"} loaded
                  {item.quantityDelivered ? ` · ${item.quantityDelivered} delivered` : ""}
                </Text>
              </View>
            </View>
          ))}
        </View>
      )}

      {/* Record Delivery button */}
      <TouchableOpacity
        style={[styles.recordBtn, { backgroundColor: colors.primary, borderRadius: colors.radius }]}
        onPress={() => router.push(`/scan-farmer?dispatchId=${dispatchId}`)}
        activeOpacity={0.85}
      >
        <Feather name="camera" size={18} color="#fff" />
        <Text style={styles.recordBtnText}>Record Delivery</Text>
      </TouchableOpacity>

      {/* PoDs summary */}
      <View>
        <Text style={[styles.sectionTitle, { color: colors.foreground }]}>
          PoD Records ({pods.length})
        </Text>
        {podsQ.isLoading ? (
          <ActivityIndicator color={colors.primary} />
        ) : pods.length === 0 ? (
          <View style={[styles.emptyPods, { backgroundColor: colors.muted, borderRadius: colors.radius }]}>
            <Feather name="clipboard" size={24} color={colors.mutedForeground} style={{ opacity: 0.4 }} />
            <Text style={[styles.emptyText, { color: colors.mutedForeground }]}>No PoDs recorded yet</Text>
          </View>
        ) : (
          pods.slice(0, 20).map((pod) => (
            <View key={pod.id} style={[styles.podRow, { backgroundColor: colors.card, borderColor: colors.border, borderRadius: colors.radius }]}>
              <View style={[styles.podIconWrap, { backgroundColor: colors.primary + "14" }]}>
                <Feather name="check-square" size={14} color={colors.primary} />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={[styles.podCode, { color: colors.primary }]}>{pod.podCode}</Text>
                <Text style={[styles.podMeta, { color: colors.mutedForeground }]}>
                  Farmer #{pod.farmerId} · {pod.quantityDelivered ?? "?"} units
                </Text>
              </View>
              <View style={styles.podBadges}>
                <StatusBadge status={pod.status} small />
                <GpsStatusPill status={(pod as any).gpsStatus} />
              </View>
            </View>
          ))
        )}
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  content: { gap: 16, padding: 16 },
  center: { flex: 1, alignItems: "center", justifyContent: "center" },
  // Info card
  infoCard: { padding: 20, borderRadius: 12, gap: 6 },
  infoRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  manifestLabel: { fontSize: 12, fontFamily: "Inter_400Regular", color: "rgba(255,255,255,0.7)", letterSpacing: 1, textTransform: "uppercase" },
  manifestCode: { fontSize: 22, fontFamily: "Inter_700Bold", color: "#ffffff" },
  destination: { fontSize: 15, fontFamily: "Inter_400Regular", color: "rgba(255,255,255,0.85)" },
  metaRow: { flexDirection: "row", gap: 16, marginTop: 6, flexWrap: "wrap" },
  metaItem: { flexDirection: "row", alignItems: "center", gap: 5 },
  metaText: { fontSize: 12, fontFamily: "Inter_400Regular", color: "rgba(255,255,255,0.7)" },
  // Arrival banner
  arrivedBanner: { flexDirection: "row", alignItems: "center", gap: 12, padding: 14, borderRadius: 10, borderWidth: 1 },
  arrivedIcon: { width: 40, height: 40, borderRadius: 20, alignItems: "center", justifyContent: "center" },
  arrivedTitle: { fontSize: 13, fontFamily: "Inter_600SemiBold" },
  arrivedSub: { fontSize: 11, fontFamily: "Inter_400Regular", marginTop: 1, opacity: 0.85 },
  // GPS tracking banner
  gpsBanner: { flexDirection: "row", alignItems: "center", gap: 10, padding: 12, borderRadius: 10, borderWidth: 1 },
  gpsIconWrap: { width: 36, height: 36, borderRadius: 18, alignItems: "center", justifyContent: "center" },
  gpsBannerTitle: { fontSize: 12, fontFamily: "Inter_600SemiBold" },
  gpsBannerSub: { fontSize: 11, fontFamily: "Inter_400Regular", marginTop: 1, opacity: 0.8 },
  gpsDot: { width: 8, height: 8, borderRadius: 4 },
  // Items
  sectionTitle: { fontSize: 15, fontFamily: "Inter_600SemiBold", marginBottom: 10 },
  itemRow: { flexDirection: "row", alignItems: "center", padding: 12, gap: 10, borderWidth: 1, marginBottom: 8 },
  itemIcon: { width: 36, height: 36, borderRadius: 10, alignItems: "center", justifyContent: "center" },
  itemName: { fontSize: 14, fontFamily: "Inter_500Medium" },
  itemQty: { fontSize: 12, fontFamily: "Inter_400Regular", marginTop: 2 },
  // Empty
  emptyPods: { padding: 28, alignItems: "center", gap: 8 },
  emptyText: { fontSize: 14, fontFamily: "Inter_400Regular" },
  // PoD rows
  podRow: { flexDirection: "row", alignItems: "center", padding: 12, borderWidth: 1, marginBottom: 8, gap: 10 },
  podIconWrap: { width: 32, height: 32, borderRadius: 8, alignItems: "center", justifyContent: "center" },
  podCode: { fontSize: 14, fontFamily: "Inter_600SemiBold" },
  podMeta: { fontSize: 12, fontFamily: "Inter_400Regular", marginTop: 2 },
  podBadges: { flexDirection: "column", alignItems: "flex-end", gap: 4 },
  // Record button
  recordBtn: { height: 52, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 10 },
  recordBtnText: { fontSize: 15, fontFamily: "Inter_600SemiBold", color: "#fff" },
});
