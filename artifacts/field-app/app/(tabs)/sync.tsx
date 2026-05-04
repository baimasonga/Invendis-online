import { Feather } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import React, { useState } from "react";
import {
  ActivityIndicator,
  Alert,
  FlatList,
  Platform,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { EmptyState } from "@/components/EmptyState";
import { useAuth } from "@/context/AuthContext";
import { useOfflineQueue } from "@/context/OfflineQueueContext";
import { useColors } from "@/hooks/useColors";

export default function SyncScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const { token } = useAuth();
  const { queue, syncAll, clearSynced, isSyncing, lastSync } = useOfflineQueue();
  const [syncResult, setSyncResult] = useState<{ success: number; failed: number } | null>(null);
  const topPad = Platform.OS === "web" ? 67 : insets.top;

  const handleSync = async () => {
    if (!token || isSyncing) return;
    await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    setSyncResult(null);
    try {
      const result = await syncAll(token);
      setSyncResult(result);
      await Haptics.notificationAsync(
        result.failed === 0
          ? Haptics.NotificationFeedbackType.Success
          : Haptics.NotificationFeedbackType.Warning
      );
    } catch {
      Alert.alert("Sync Failed", "Could not connect to server. Check your connection.");
    }
  };

  const handleClear = () => {
    Alert.alert("Clear Failed Items", "Remove items that failed to sync?", [
      { text: "Cancel", style: "cancel" },
      { text: "Clear", style: "destructive", onPress: clearSynced },
    ]);
  };

  const pendingCount = queue.filter((i) => i.status === "pending").length;
  const failedCount = queue.filter((i) => i.status === "failed").length;

  return (
    <View style={[styles.root, { backgroundColor: colors.background }]}>
      {/* Header */}
      <View style={[styles.header, { paddingTop: topPad + 12, backgroundColor: colors.background, borderBottomColor: colors.border }]}>
        <Text style={[styles.title, { color: colors.foreground }]}>Offline Queue</Text>
        {failedCount > 0 && (
          <TouchableOpacity onPress={handleClear}>
            <Text style={[styles.clearBtn, { color: colors.destructive }]}>Clear failed</Text>
          </TouchableOpacity>
        )}
      </View>

      {/* Stats row */}
      <View style={[styles.statsRow, { borderBottomColor: colors.border }]}>
        <View style={styles.stat}>
          <Text style={[styles.statNum, { color: colors.warning }]}>{pendingCount}</Text>
          <Text style={[styles.statLabel, { color: colors.mutedForeground }]}>Pending</Text>
        </View>
        <View style={[styles.divider, { backgroundColor: colors.border }]} />
        <View style={styles.stat}>
          <Text style={[styles.statNum, { color: colors.destructive }]}>{failedCount}</Text>
          <Text style={[styles.statLabel, { color: colors.mutedForeground }]}>Failed</Text>
        </View>
        <View style={[styles.divider, { backgroundColor: colors.border }]} />
        <View style={styles.stat}>
          <Text style={[styles.statNum, { color: colors.mutedForeground }]}>
            {lastSync ? new Date(lastSync).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }) : "—"}
          </Text>
          <Text style={[styles.statLabel, { color: colors.mutedForeground }]}>Last Sync</Text>
        </View>
      </View>

      {/* Sync result */}
      {syncResult && (
        <View style={[styles.resultBanner, {
          backgroundColor: syncResult.failed === 0 ? colors.success + "18" : colors.warning + "18",
          borderColor: syncResult.failed === 0 ? colors.success + "40" : colors.warning + "40"
        }]}>
          <Feather
            name={syncResult.failed === 0 ? "check-circle" : "alert-triangle"}
            size={16}
            color={syncResult.failed === 0 ? colors.success : colors.warning}
          />
          <Text style={[styles.resultText, { color: syncResult.failed === 0 ? colors.success : colors.warning }]}>
            {syncResult.success} synced successfully{syncResult.failed > 0 ? `, ${syncResult.failed} failed` : ""}
          </Text>
        </View>
      )}

      {/* Queue list */}
      <FlatList
        data={queue}
        keyExtractor={(i) => i.id}
        contentContainerStyle={[styles.list, { paddingBottom: insets.bottom + 120 }]}
        ListEmptyComponent={
          <EmptyState
            icon="check-circle"
            title="Queue is empty"
            subtitle="All PoD submissions have been synced successfully"
          />
        }
        renderItem={({ item }) => (
          <View style={[styles.queueItem, {
            backgroundColor: colors.card,
            borderRadius: colors.radius,
            borderColor: item.status === "failed" ? colors.destructive + "40" : colors.border,
          }]}>
            <View style={[styles.statusDot, {
              backgroundColor: item.status === "pending" ? colors.warning : colors.destructive
            }]} />
            <View style={styles.itemInfo}>
              <Text style={[styles.itemId, { color: colors.foreground }]}>
                Dispatch #{(item.payload as { dispatchId?: number }).dispatchId ?? "—"}
              </Text>
              <Text style={[styles.itemDate, { color: colors.mutedForeground }]}>
                {new Date(item.createdAt).toLocaleString()}
              </Text>
              {item.error && item.error !== "synced" && (
                <Text style={[styles.itemError, { color: colors.destructive }]}>{item.error}</Text>
              )}
            </View>
            <View style={[styles.badge, {
              backgroundColor: item.status === "pending" ? colors.warning + "18" : colors.destructive + "18",
              borderRadius: 6,
            }]}>
              <Text style={[styles.badgeText, { color: item.status === "pending" ? colors.warning : colors.destructive }]}>
                {item.status}
              </Text>
            </View>
          </View>
        )}
        scrollEnabled={!!queue.length}
      />

      {/* Sync button */}
      <View style={[styles.footer, { paddingBottom: insets.bottom + 20, borderTopColor: colors.border, backgroundColor: colors.background }]}>
        <TouchableOpacity
          style={[styles.syncBtn, {
            backgroundColor: pendingCount === 0 ? colors.muted : colors.primary,
            borderRadius: colors.radius,
            opacity: isSyncing ? 0.7 : 1,
          }]}
          onPress={handleSync}
          disabled={isSyncing || pendingCount === 0}
          activeOpacity={0.85}
        >
          {isSyncing ? (
            <ActivityIndicator color="#fff" />
          ) : (
            <>
              <Feather name="upload-cloud" size={20} color={pendingCount === 0 ? colors.mutedForeground : "#fff"} />
              <Text style={[styles.syncBtnText, { color: pendingCount === 0 ? colors.mutedForeground : "#fff" }]}>
                {pendingCount === 0 ? "Nothing to sync" : `Sync ${pendingCount} item${pendingCount !== 1 ? "s" : ""}`}
              </Text>
            </>
          )}
        </TouchableOpacity>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  header: { paddingHorizontal: 20, paddingBottom: 14, flexDirection: "row", justifyContent: "space-between", alignItems: "center", borderBottomWidth: 1 },
  title: { fontSize: 24, fontFamily: "Inter_700Bold" },
  clearBtn: { fontSize: 13, fontFamily: "Inter_500Medium" },
  statsRow: { flexDirection: "row", paddingVertical: 16, borderBottomWidth: 1 },
  stat: { flex: 1, alignItems: "center", gap: 4 },
  statNum: { fontSize: 28, fontFamily: "Inter_700Bold" },
  statLabel: { fontSize: 11, fontFamily: "Inter_400Regular" },
  divider: { width: 1, marginVertical: 4 },
  resultBanner: { margin: 16, flexDirection: "row", alignItems: "center", gap: 10, padding: 12, borderRadius: 8, borderWidth: 1 },
  resultText: { fontSize: 13, fontFamily: "Inter_500Medium", flex: 1 },
  list: { padding: 16, gap: 10 },
  queueItem: { flexDirection: "row", alignItems: "center", padding: 14, gap: 12, borderWidth: 1, marginBottom: 8 },
  statusDot: { width: 8, height: 8, borderRadius: 4 },
  itemInfo: { flex: 1, gap: 2 },
  itemId: { fontSize: 14, fontFamily: "Inter_500Medium" },
  itemDate: { fontSize: 12, fontFamily: "Inter_400Regular" },
  itemError: { fontSize: 12, fontFamily: "Inter_400Regular", marginTop: 2 },
  badge: { paddingHorizontal: 8, paddingVertical: 3 },
  badgeText: { fontSize: 11, fontFamily: "Inter_600SemiBold" },
  footer: { padding: 16, borderTopWidth: 1 },
  syncBtn: { height: 52, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 10 },
  syncBtnText: { fontSize: 15, fontFamily: "Inter_600SemiBold" },
});
