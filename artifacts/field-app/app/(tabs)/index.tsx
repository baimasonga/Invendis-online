import { Feather } from "@expo/vector-icons";
import { useQuery } from "@tanstack/react-query";
import { useRouter } from "expo-router";
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
import { useAuth } from "@/context/AuthContext";
import { useOfflineQueue } from "@/context/OfflineQueueContext";
import { useColors } from "@/hooks/useColors";
import { getPodStats, listDispatches } from "@/lib/api";

function StatCard({ label, value, color, icon }: { label: string; value: string | number; color: string; icon: keyof typeof Feather.glyphMap }) {
  const colors = useColors();
  return (
    <View style={[styles.statCard, { backgroundColor: colors.card, borderRadius: colors.radius, borderColor: colors.border }]}>
      <View style={[styles.statIcon, { backgroundColor: color + "18" }]}>
        <Feather name={icon} size={20} color={color} />
      </View>
      <Text style={[styles.statValue, { color: colors.foreground }]}>{value}</Text>
      <Text style={[styles.statLabel, { color: colors.mutedForeground }]}>{label}</Text>
    </View>
  );
}

export default function DashboardScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const { user, token } = useAuth();
  const { queue } = useOfflineQueue();
  const router = useRouter();

  const podStatsQ = useQuery({
    queryKey: ["pod-stats"],
    queryFn: () => getPodStats(token!),
    enabled: !!token,
  });

  const dispatchQ = useQuery({
    queryKey: ["dispatches"],
    queryFn: () => listDispatches(token!, { status: "In Transit", limit: "3" }),
    enabled: !!token,
  });

  const isLoading = podStatsQ.isLoading || dispatchQ.isLoading;
  const refetch = () => { podStatsQ.refetch(); dispatchQ.refetch(); };

  const topPad = Platform.OS === "web" ? 67 : insets.top;

  const greeting = () => {
    const h = new Date().getHours();
    if (h < 12) return "Good morning";
    if (h < 17) return "Good afternoon";
    return "Good evening";
  };

  return (
    <ScrollView
      style={[styles.root, { backgroundColor: colors.background }]}
      contentContainerStyle={[styles.content, { paddingTop: topPad + 16, paddingBottom: insets.bottom + 100 }]}
      refreshControl={<RefreshControl refreshing={isLoading} onRefresh={refetch} tintColor={colors.primary} />}
    >
      {/* Header */}
      <View style={styles.header}>
        <View>
          <Text style={[styles.greeting, { color: colors.mutedForeground }]}>{greeting()}</Text>
          <Text style={[styles.name, { color: colors.foreground }]}>{user?.fullName ?? user?.username ?? "Officer"}</Text>
        </View>
        <View style={[styles.onlineChip, { backgroundColor: colors.success + "18" }]}>
          <View style={[styles.dot, { backgroundColor: colors.success }]} />
          <Text style={[styles.onlineText, { color: colors.success }]}>Online</Text>
        </View>
      </View>

      {/* Stats */}
      <Text style={[styles.sectionTitle, { color: colors.foreground }]}>Today's Summary</Text>
      {podStatsQ.isLoading ? (
        <ActivityIndicator color={colors.primary} style={{ marginVertical: 24 }} />
      ) : (
        <View style={styles.statsRow}>
          <StatCard label="Total PoDs" value={podStatsQ.data?.total ?? 0} color={colors.info} icon="clipboard" />
          <StatCard label="Verified" value={podStatsQ.data?.verified ?? 0} color={colors.success} icon="check-circle" />
          <StatCard label="Pending" value={podStatsQ.data?.pending ?? 0} color={colors.warning} icon="clock" />
        </View>
      )}

      {/* Offline queue */}
      {queue.length > 0 && (
        <TouchableOpacity
          style={[styles.syncBanner, { backgroundColor: colors.warning + "18", borderColor: colors.warning + "40", borderRadius: colors.radius }]}
          onPress={() => router.push("/(tabs)/sync")}
          activeOpacity={0.8}
        >
          <Feather name="wifi-off" size={16} color={colors.warning} />
          <Text style={[styles.syncText, { color: colors.warning }]}>
            {queue.length} submission{queue.length > 1 ? "s" : ""} queued — tap to sync
          </Text>
          <Feather name="chevron-right" size={16} color={colors.warning} />
        </TouchableOpacity>
      )}

      {/* Active dispatches */}
      <View style={styles.section}>
        <View style={styles.sectionRow}>
          <Text style={[styles.sectionTitle, { color: colors.foreground }]}>Active Dispatches</Text>
          <TouchableOpacity onPress={() => router.push("/(tabs)/distributions")}>
            <Text style={[styles.seeAll, { color: colors.primary }]}>See all</Text>
          </TouchableOpacity>
        </View>
        {dispatchQ.isLoading ? (
          <ActivityIndicator color={colors.primary} style={{ marginVertical: 16 }} />
        ) : !dispatchQ.data?.data?.length ? (
          <View style={[styles.emptyCard, { backgroundColor: colors.muted, borderRadius: colors.radius }]}>
            <Text style={[styles.emptyText, { color: colors.mutedForeground }]}>No active dispatches</Text>
          </View>
        ) : (
          dispatchQ.data.data.map((d) => (
            <TouchableOpacity
              key={d.id}
              style={[styles.dispatchCard, { backgroundColor: colors.card, borderRadius: colors.radius, borderColor: colors.border }]}
              onPress={() => router.push(`/distribution/${d.id}`)}
              activeOpacity={0.8}
            >
              <View style={styles.dispatchLeft}>
                <Text style={[styles.manifestCode, { color: colors.primary }]}>{d.manifestCode}</Text>
                <Text style={[styles.dispatchDest, { color: colors.mutedForeground }]}>
                  {d.destinationCommunity ?? d.destinationDistrict ?? "—"}
                </Text>
              </View>
              <View style={styles.dispatchRight}>
                <View style={[styles.statusPill, { backgroundColor: colors.info + "18" }]}>
                  <Text style={[styles.statusText, { color: colors.info }]}>{d.status}</Text>
                </View>
                <Feather name="chevron-right" size={18} color={colors.mutedForeground} />
              </View>
            </TouchableOpacity>
          ))
        )}
      </View>

      {/* Quick actions */}
      <Text style={[styles.sectionTitle, { color: colors.foreground }]}>Quick Actions</Text>
      <View style={styles.actionsRow}>
        <TouchableOpacity
          style={[styles.actionBtn, { backgroundColor: colors.primary, borderRadius: colors.radius }]}
          onPress={() => router.push("/(tabs)/scan")}
          activeOpacity={0.85}
        >
          <Feather name="camera" size={22} color="#fff" />
          <Text style={styles.actionBtnText}>Scan Farmer</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.actionBtn, { backgroundColor: colors.card, borderRadius: colors.radius, borderWidth: 1, borderColor: colors.border }]}
          onPress={() => router.push("/incident/new")}
          activeOpacity={0.85}
        >
          <Feather name="alert-triangle" size={22} color={colors.warning} />
          <Text style={[styles.actionBtnText, { color: colors.foreground }]}>Report Incident</Text>
        </TouchableOpacity>
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  content: { paddingHorizontal: 20, gap: 16 },
  header: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: 4 },
  greeting: { fontSize: 13, fontFamily: "Inter_400Regular" },
  name: { fontSize: 22, fontFamily: "Inter_700Bold", marginTop: 2 },
  onlineChip: { flexDirection: "row", alignItems: "center", gap: 6, paddingHorizontal: 10, paddingVertical: 5, borderRadius: 20 },
  dot: { width: 7, height: 7, borderRadius: 4 },
  onlineText: { fontSize: 12, fontFamily: "Inter_500Medium" },
  sectionTitle: { fontSize: 16, fontFamily: "Inter_600SemiBold" },
  sectionRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: 10 },
  seeAll: { fontSize: 13, fontFamily: "Inter_500Medium" },
  statsRow: { flexDirection: "row", gap: 10 },
  statCard: { flex: 1, padding: 14, gap: 6, borderWidth: 1, alignItems: "center" },
  statIcon: { width: 40, height: 40, borderRadius: 12, alignItems: "center", justifyContent: "center" },
  statValue: { fontSize: 24, fontFamily: "Inter_700Bold" },
  statLabel: { fontSize: 11, fontFamily: "Inter_400Regular", textAlign: "center" },
  syncBanner: { flexDirection: "row", alignItems: "center", gap: 10, padding: 12, borderWidth: 1 },
  syncText: { flex: 1, fontSize: 13, fontFamily: "Inter_500Medium" },
  section: { gap: 0 },
  emptyCard: { padding: 20, alignItems: "center" },
  emptyText: { fontSize: 14, fontFamily: "Inter_400Regular" },
  dispatchCard: { flexDirection: "row", alignItems: "center", padding: 14, marginBottom: 8, borderWidth: 1, justifyContent: "space-between" },
  dispatchLeft: { gap: 3 },
  manifestCode: { fontSize: 14, fontFamily: "Inter_600SemiBold" },
  dispatchDest: { fontSize: 12, fontFamily: "Inter_400Regular" },
  dispatchRight: { flexDirection: "row", alignItems: "center", gap: 8 },
  statusPill: { paddingHorizontal: 8, paddingVertical: 3, borderRadius: 6 },
  statusText: { fontSize: 11, fontFamily: "Inter_500Medium" },
  actionsRow: { flexDirection: "row", gap: 12 },
  actionBtn: { flex: 1, padding: 16, alignItems: "center", gap: 8 },
  actionBtnText: { fontSize: 13, fontFamily: "Inter_600SemiBold", color: "#ffffff" },
});
