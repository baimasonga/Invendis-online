import { Feather } from "@expo/vector-icons";
import { useQuery } from "@tanstack/react-query";
import { useLocalSearchParams, useRouter } from "expo-router";
import React from "react";
import {
  ActivityIndicator,
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
import { getDispatch, listPoDs } from "@/lib/api";

export default function DistributionDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const { token } = useAuth();
  const router = useRouter();
  const dispatchId = Number(id);

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
          {dispatch.departureTime && (
            <View style={styles.metaItem}>
              <Feather name="clock" size={13} color="rgba(255,255,255,0.7)" />
              <Text style={styles.metaText}>{new Date(dispatch.departureTime).toLocaleDateString()}</Text>
            </View>
          )}
        </View>
      </View>

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
            <Text style={[styles.emptyText, { color: colors.mutedForeground }]}>No PoDs recorded yet</Text>
          </View>
        ) : (
          pods.slice(0, 10).map((pod) => (
            <View key={pod.id} style={[styles.podRow, { backgroundColor: colors.card, borderColor: colors.border, borderRadius: colors.radius }]}>
              <View style={{ flex: 1 }}>
                <Text style={[styles.podCode, { color: colors.primary }]}>{pod.podCode}</Text>
                <Text style={[styles.podMeta, { color: colors.mutedForeground }]}>
                  Farmer #{pod.farmerId} · {pod.quantityDelivered ?? "?"} units
                </Text>
              </View>
              <StatusBadge status={pod.status} small />
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
  infoCard: { padding: 20, borderRadius: 12, gap: 6 },
  infoRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  manifestLabel: { fontSize: 12, fontFamily: "Inter_400Regular", color: "rgba(255,255,255,0.7)", letterSpacing: 1, textTransform: "uppercase" },
  manifestCode: { fontSize: 22, fontFamily: "Inter_700Bold", color: "#ffffff" },
  destination: { fontSize: 15, fontFamily: "Inter_400Regular", color: "rgba(255,255,255,0.85)" },
  metaRow: { flexDirection: "row", gap: 16, marginTop: 6 },
  metaItem: { flexDirection: "row", alignItems: "center", gap: 5 },
  metaText: { fontSize: 12, fontFamily: "Inter_400Regular", color: "rgba(255,255,255,0.7)" },
  sectionTitle: { fontSize: 15, fontFamily: "Inter_600SemiBold", marginBottom: 10 },
  itemRow: { flexDirection: "row", alignItems: "center", padding: 12, gap: 10, borderWidth: 1, marginBottom: 8 },
  itemIcon: { width: 36, height: 36, borderRadius: 10, alignItems: "center", justifyContent: "center" },
  itemName: { fontSize: 14, fontFamily: "Inter_500Medium" },
  itemQty: { fontSize: 12, fontFamily: "Inter_400Regular", marginTop: 2 },
  emptyPods: { padding: 20, alignItems: "center" },
  emptyText: { fontSize: 14, fontFamily: "Inter_400Regular" },
  podRow: { flexDirection: "row", alignItems: "center", padding: 12, borderWidth: 1, marginBottom: 8 },
  podCode: { fontSize: 14, fontFamily: "Inter_600SemiBold" },
  podMeta: { fontSize: 12, fontFamily: "Inter_400Regular", marginTop: 2 },
  recordBtn: { height: 52, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 10 },
  recordBtnText: { fontSize: 15, fontFamily: "Inter_600SemiBold", color: "#fff" },
});
