import { Feather } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import { useQuery } from "@tanstack/react-query";
import { useRouter } from "expo-router";
import React, { useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Modal,
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

function ProfileModal({ visible, onClose }: { visible: boolean; onClose: () => void }) {
  const colors = useColors();
  const { user, logout } = useAuth();
  const router = useRouter();

  const handleLogout = () => {
    Alert.alert("Sign Out", "Are you sure you want to sign out?", [
      { text: "Cancel", style: "cancel" },
      {
        text: "Sign Out",
        style: "destructive",
        onPress: async () => {
          onClose();
          await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
          await logout();
          router.replace("/login");
        },
      },
    ]);
  };

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <TouchableOpacity style={profileStyles.backdrop} activeOpacity={1} onPress={onClose} />
      <View style={[profileStyles.sheet, { backgroundColor: colors.card, borderColor: colors.border }]}>
        <View style={[profileStyles.handle, { backgroundColor: colors.border }]} />
        <View style={[profileStyles.avatarWrap, { backgroundColor: colors.primary + "18" }]}>
          <Feather name="user" size={36} color={colors.primary} />
        </View>
        <Text style={[profileStyles.name, { color: colors.foreground }]}>{user?.fullName ?? user?.username ?? "Field Officer"}</Text>
        <Text style={[profileStyles.sub, { color: colors.mutedForeground }]}>{user?.role ?? ""}</Text>
        {user?.email ? (
          <Text style={[profileStyles.email, { color: colors.mutedForeground }]}>{user.email}</Text>
        ) : null}
        <View style={[profileStyles.divider, { backgroundColor: colors.border }]} />
        <TouchableOpacity
          style={[profileStyles.logoutBtn, { borderColor: colors.destructive + "60", backgroundColor: colors.destructive + "10", borderRadius: colors.radius }]}
          onPress={handleLogout}
          activeOpacity={0.85}
        >
          <Feather name="log-out" size={18} color={colors.destructive} />
          <Text style={[profileStyles.logoutText, { color: colors.destructive }]}>Sign Out</Text>
        </TouchableOpacity>
        <TouchableOpacity style={profileStyles.cancelBtn} onPress={onClose}>
          <Text style={[profileStyles.cancelText, { color: colors.mutedForeground }]}>Cancel</Text>
        </TouchableOpacity>
      </View>
    </Modal>
  );
}

const profileStyles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: "rgba(0,0,0,0.4)" },
  sheet: { borderTopLeftRadius: 20, borderTopRightRadius: 20, padding: 24, gap: 12, alignItems: "center", borderTopWidth: 1 },
  handle: { width: 40, height: 4, borderRadius: 2, marginBottom: 8 },
  avatarWrap: { width: 80, height: 80, borderRadius: 40, alignItems: "center", justifyContent: "center" },
  name: { fontSize: 20, fontFamily: "Inter_700Bold", marginTop: 4 },
  sub: { fontSize: 13, fontFamily: "Inter_400Regular", textTransform: "capitalize" },
  email: { fontSize: 12, fontFamily: "Inter_400Regular" },
  divider: { width: "100%", height: 1, marginVertical: 4 },
  logoutBtn: { width: "100%", flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 10, height: 50, borderWidth: 1 },
  logoutText: { fontSize: 15, fontFamily: "Inter_600SemiBold" },
  cancelBtn: { paddingVertical: 8 },
  cancelText: { fontSize: 14, fontFamily: "Inter_400Regular" },
});

export default function DashboardScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const { user, token } = useAuth();
  const { queue } = useOfflineQueue();
  const router = useRouter();
  const [profileOpen, setProfileOpen] = useState(false);

  const podStatsQ = useQuery({
    queryKey: ["pod-stats"],
    queryFn: () => getPodStats(token!),
    enabled: !!token,
  });

  const inTransitQ = useQuery({
    queryKey: ["dispatches", "in-transit"],
    queryFn: () => listDispatches(token!, { status: "In Transit", limit: "3" }),
    enabled: !!token,
  });
  const arrivedQ = useQuery({
    queryKey: ["dispatches", "arrived"],
    queryFn: () => listDispatches(token!, { status: "Arrived", limit: "3" }),
    enabled: !!token,
  });

  const dispatchQ = inTransitQ; // keep refetch reference for pull-to-refresh

  const isLoading = podStatsQ.isLoading || inTransitQ.isLoading || arrivedQ.isLoading;
  const refetch = () => { podStatsQ.refetch(); inTransitQ.refetch(); arrivedQ.refetch(); };

  const activeDispatches = [
    ...(inTransitQ.data?.data ?? []),
    ...(arrivedQ.data?.data ?? []),
  ].slice(0, 4);

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
      <ProfileModal visible={profileOpen} onClose={() => setProfileOpen(false)} />
      <View style={styles.header}>
        <View>
          <Text style={[styles.greeting, { color: colors.mutedForeground }]}>{greeting()}</Text>
          <Text style={[styles.name, { color: colors.foreground }]}>{user?.fullName ?? user?.username ?? "Officer"}</Text>
        </View>
        <TouchableOpacity
          style={[styles.profileBtn, { backgroundColor: colors.primary + "14", borderColor: colors.primary + "30" }]}
          onPress={async () => {
            await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
            setProfileOpen(true);
          }}
          activeOpacity={0.8}
        >
          <Feather name="user" size={18} color={colors.primary} />
        </TouchableOpacity>
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

      {/* Record Delivery CTA */}
      <TouchableOpacity
        style={[styles.recordDeliveryCard, { backgroundColor: colors.primary, borderRadius: colors.radius }]}
        onPress={() => router.push("/(tabs)/scan")}
        activeOpacity={0.87}
      >
        <View style={styles.recordDeliveryLeft}>
          <Text style={styles.recordDeliveryTitle}>Record Delivery</Text>
          <Text style={styles.recordDeliverySub}>Scan farmer · Capture GPS · Take photos · OTP verify</Text>
          <View style={styles.recordDeliveryIcons}>
            <View style={styles.recordDeliveryIconChip}>
              <Feather name="user" size={12} color="rgba(255,255,255,0.9)" />
              <Text style={styles.recordDeliveryIconText}>Scan</Text>
            </View>
            <View style={styles.recordDeliveryIconChip}>
              <Feather name="map-pin" size={12} color="rgba(255,255,255,0.9)" />
              <Text style={styles.recordDeliveryIconText}>GPS</Text>
            </View>
            <View style={styles.recordDeliveryIconChip}>
              <Feather name="camera" size={12} color="rgba(255,255,255,0.9)" />
              <Text style={styles.recordDeliveryIconText}>Photos</Text>
            </View>
            <View style={styles.recordDeliveryIconChip}>
              <Feather name="shield" size={12} color="rgba(255,255,255,0.9)" />
              <Text style={styles.recordDeliveryIconText}>OTP</Text>
            </View>
          </View>
        </View>
        <View style={styles.recordDeliveryArrow}>
          <Feather name="arrow-right" size={20} color="#fff" />
        </View>
      </TouchableOpacity>

      {/* Active dispatches */}
      <View style={styles.section}>
        <View style={styles.sectionRow}>
          <Text style={[styles.sectionTitle, { color: colors.foreground }]}>Active Dispatches</Text>
          <TouchableOpacity onPress={() => router.push("/(tabs)/distributions")}>
            <Text style={[styles.seeAll, { color: colors.primary }]}>See all</Text>
          </TouchableOpacity>
        </View>
        {(inTransitQ.isLoading || arrivedQ.isLoading) ? (
          <ActivityIndicator color={colors.primary} style={{ marginVertical: 16 }} />
        ) : activeDispatches.length === 0 ? (
          <View style={[styles.emptyCard, { backgroundColor: colors.muted, borderRadius: colors.radius }]}>
            <Feather name="truck" size={20} color={colors.mutedForeground} style={{ opacity: 0.4, marginBottom: 6 }} />
            <Text style={[styles.emptyText, { color: colors.mutedForeground }]}>No active dispatches</Text>
            <Text style={[styles.emptySubText, { color: colors.mutedForeground }]}>
              Use the Distributions tab to see all manifests
            </Text>
          </View>
        ) : (
          activeDispatches.map((d) => {
            const isArrived = d.status === "Arrived";
            return (
              <TouchableOpacity
                key={d.id}
                style={[styles.dispatchCard, { backgroundColor: colors.card, borderRadius: colors.radius, borderColor: isArrived ? colors.success + "60" : colors.border }]}
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
                  <View style={[styles.statusPill, { backgroundColor: (isArrived ? colors.success : colors.info) + "18" }]}>
                    <Text style={[styles.statusText, { color: isArrived ? colors.success : colors.info }]}>{d.status}</Text>
                  </View>
                  {isArrived && (
                    <View style={[styles.recordChip, { backgroundColor: colors.success + "20" }]}>
                      <Feather name="camera" size={11} color={colors.success} />
                      <Text style={[styles.recordChipText, { color: colors.success }]}>Record</Text>
                    </View>
                  )}
                  <Feather name="chevron-right" size={18} color={colors.mutedForeground} />
                </View>
              </TouchableOpacity>
            );
          })
        )}
      </View>

      {/* Quick actions */}
      <Text style={[styles.sectionTitle, { color: colors.foreground }]}>Quick Actions</Text>
      <View style={styles.actionsRow}>
        <TouchableOpacity
          style={[styles.actionBtn, { backgroundColor: colors.card, borderRadius: colors.radius, borderWidth: 1, borderColor: colors.border }]}
          onPress={() => router.push("/(tabs)/scan")}
          activeOpacity={0.85}
        >
          <Feather name="search" size={22} color={colors.primary} />
          <Text style={[styles.actionBtnText, { color: colors.foreground }]}>Scan Farmer</Text>
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
  profileBtn: { width: 40, height: 40, borderRadius: 20, alignItems: "center", justifyContent: "center", borderWidth: 1 },
  greeting: { fontSize: 13, fontFamily: "Inter_400Regular" },
  name: { fontSize: 22, fontFamily: "Inter_700Bold", marginTop: 2 },
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
  emptyCard: { padding: 20, alignItems: "center", gap: 4 },
  emptyText: { fontSize: 14, fontFamily: "Inter_400Regular" },
  emptySubText: { fontSize: 12, fontFamily: "Inter_400Regular", opacity: 0.7, textAlign: "center" },
  dispatchCard: { flexDirection: "row", alignItems: "center", padding: 14, marginBottom: 8, borderWidth: 1, justifyContent: "space-between" },
  dispatchLeft: { gap: 3, flex: 1, marginRight: 8 },
  manifestCode: { fontSize: 14, fontFamily: "Inter_600SemiBold" },
  dispatchDest: { fontSize: 12, fontFamily: "Inter_400Regular" },
  dispatchRight: { flexDirection: "row", alignItems: "center", gap: 6, flexShrink: 0 },
  statusPill: { paddingHorizontal: 8, paddingVertical: 3, borderRadius: 6 },
  statusText: { fontSize: 11, fontFamily: "Inter_500Medium" },
  recordChip: { flexDirection: "row", alignItems: "center", gap: 3, paddingHorizontal: 6, paddingVertical: 2, borderRadius: 4 },
  recordChipText: { fontSize: 10, fontFamily: "Inter_600SemiBold" },
  actionsRow: { flexDirection: "row", gap: 12 },
  actionBtn: { flex: 1, padding: 16, alignItems: "center", gap: 8 },
  actionBtnText: { fontSize: 13, fontFamily: "Inter_600SemiBold", color: "#ffffff" },
  // Record Delivery CTA
  recordDeliveryCard: { flexDirection: "row", alignItems: "center", padding: 18, gap: 12 },
  recordDeliveryLeft: { flex: 1, gap: 6 },
  recordDeliveryTitle: { fontSize: 17, fontFamily: "Inter_700Bold", color: "#fff" },
  recordDeliverySub: { fontSize: 12, fontFamily: "Inter_400Regular", color: "rgba(255,255,255,0.8)", lineHeight: 17 },
  recordDeliveryIcons: { flexDirection: "row", gap: 6, marginTop: 2 },
  recordDeliveryIconChip: { flexDirection: "row", alignItems: "center", gap: 4, backgroundColor: "rgba(255,255,255,0.18)", paddingHorizontal: 8, paddingVertical: 4, borderRadius: 20 },
  recordDeliveryIconText: { fontSize: 11, fontFamily: "Inter_600SemiBold", color: "rgba(255,255,255,0.95)" },
  recordDeliveryArrow: { width: 36, height: 36, borderRadius: 18, backgroundColor: "rgba(255,255,255,0.2)", alignItems: "center", justifyContent: "center" },
});
