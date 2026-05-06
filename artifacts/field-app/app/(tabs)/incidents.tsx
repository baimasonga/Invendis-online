import { Feather } from "@expo/vector-icons";
import AsyncStorage from "@react-native-async-storage/async-storage";
import * as Haptics from "expo-haptics";
import { useRouter } from "expo-router";
import React, { useCallback, useState } from "react";
import {
  ActivityIndicator,
  FlatList,
  Platform,
  RefreshControl,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { EmptyState } from "@/components/EmptyState";
import { StatusBadge } from "@/components/StatusBadge";
import { useColors } from "@/hooks/useColors";
import { useAuth } from "@/context/AuthContext";

export interface Incident {
  id: string;
  incidentCode?: string;
  type: string;
  description: string;
  location: string;
  latitude?: number;
  longitude?: number;
  createdAt: string;
  synced: boolean;
}

const INCIDENTS_KEY = "@incidents";

export async function loadIncidents(): Promise<Incident[]> {
  try {
    const stored = await AsyncStorage.getItem(INCIDENTS_KEY);
    return stored ? JSON.parse(stored) : [];
  } catch {
    return [];
  }
}

async function saveIncidents(incidents: Incident[]) {
  await AsyncStorage.setItem(INCIDENTS_KEY, JSON.stringify(incidents));
}

export default function IncidentsScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { token } = useAuth();
  const [incidents, setIncidents] = useState<Incident[]>([]);
  const [refreshing, setRefreshing] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [syncResult, setSyncResult] = useState<{ synced: number; failed: number } | null>(null);

  const topPad = Platform.OS === "web" ? 67 : insets.top;

  const refresh = useCallback(async () => {
    setRefreshing(true);
    const data = await loadIncidents();
    setIncidents(data.sort((a, b) => b.createdAt.localeCompare(a.createdAt)));
    setRefreshing(false);
  }, []);

  React.useEffect(() => { refresh(); }, [refresh]);

  const handleSync = async () => {
    const unsynced = incidents.filter((i) => !i.synced);
    if (!unsynced.length || !token) return;
    setSyncing(true);
    setSyncResult(null);
    const domain = process.env.EXPO_PUBLIC_DOMAIN;
    let synced = 0;
    let failed = 0;
    const updated = [...incidents];

    for (const inc of unsynced) {
      try {
        const res = await fetch(`https://${domain}/api/incidents`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${token}`,
          },
          body: JSON.stringify({
            type: inc.type,
            description: inc.description,
            location: inc.location || null,
            latitude: inc.latitude ?? null,
            longitude: inc.longitude ?? null,
            incidentCode: inc.incidentCode,
            deviceId: inc.id,
          }),
        });
        if (res.ok) {
          const idx = updated.findIndex((u) => u.id === inc.id);
          if (idx !== -1) updated[idx] = { ...updated[idx], synced: true };
          synced++;
        } else {
          failed++;
        }
      } catch {
        failed++;
      }
    }

    await saveIncidents(updated);
    setIncidents(updated.sort((a, b) => b.createdAt.localeCompare(a.createdAt)));
    setSyncResult({ synced, failed });
    setSyncing(false);
  };

  const incidentTypeIcon: Record<string, keyof typeof Feather.glyphMap> = {
    "Fraud Attempt": "alert-octagon",
    "System Issue": "cpu",
    "Stock Discrepancy": "package",
    "Farmer Dispute": "users",
    "Safety Concern": "shield",
    "Other": "flag",
  };

  const unsyncedCount = incidents.filter((i) => !i.synced).length;

  return (
    <View style={[styles.root, { backgroundColor: colors.background }]}>
      <View style={[styles.header, { paddingTop: topPad + 12, backgroundColor: colors.background, borderBottomColor: colors.border }]}>
        <Text style={[styles.title, { color: colors.foreground }]}>Incidents</Text>
        <View style={styles.headerActions}>
          {unsyncedCount > 0 && (
            <TouchableOpacity
              style={[styles.syncBtn, { backgroundColor: colors.muted, borderRadius: colors.radius }]}
              onPress={handleSync}
              disabled={syncing || !token}
              activeOpacity={0.8}
            >
              {syncing ? (
                <ActivityIndicator size="small" color={colors.primary} />
              ) : (
                <>
                  <Feather name="upload-cloud" size={14} color={colors.primary} />
                  <Text style={[styles.syncBtnText, { color: colors.primary }]}>Sync {unsyncedCount}</Text>
                </>
              )}
            </TouchableOpacity>
          )}
          <TouchableOpacity
            style={[styles.addBtn, { backgroundColor: colors.primary, borderRadius: colors.radius }]}
            onPress={async () => {
              await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
              router.push("/incident/new");
            }}
            activeOpacity={0.85}
          >
            <Feather name="plus" size={18} color="#fff" />
            <Text style={styles.addBtnText}>Report</Text>
          </TouchableOpacity>
        </View>
      </View>

      {syncResult && (
        <View style={[styles.resultBanner, {
          backgroundColor: syncResult.failed === 0 ? colors.success + "18" : colors.warning + "18",
          borderColor: syncResult.failed === 0 ? colors.success + "40" : colors.warning + "40",
        }]}>
          <Feather
            name={syncResult.failed === 0 ? "check-circle" : "alert-triangle"}
            size={14}
            color={syncResult.failed === 0 ? colors.success : colors.warning}
          />
          <Text style={[styles.resultText, { color: syncResult.failed === 0 ? colors.success : colors.warning }]}>
            {syncResult.synced} incident{syncResult.synced !== 1 ? "s" : ""} synced
            {syncResult.failed > 0 ? `, ${syncResult.failed} failed` : ""}
          </Text>
        </View>
      )}

      <FlatList
        data={incidents}
        keyExtractor={(i) => i.id}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={refresh} tintColor={colors.primary} />}
        contentContainerStyle={[styles.list, { paddingBottom: insets.bottom + 100 }]}
        ListEmptyComponent={
          <EmptyState
            icon="flag"
            title="No incidents reported"
            subtitle="Report issues you encounter in the field"
            actionLabel="Report Incident"
            onAction={() => router.push("/incident/new")}
          />
        }
        renderItem={({ item }) => (
          <View style={[styles.card, {
            backgroundColor: colors.card,
            borderRadius: colors.radius,
            borderColor: item.synced ? colors.border : colors.warning + "60",
          }]}>
            <View style={styles.cardTop}>
              <View style={[styles.iconWrap, { backgroundColor: colors.warning + "18" }]}>
                <Feather name={incidentTypeIcon[item.type] ?? "flag"} size={18} color={colors.warning} />
              </View>
              <View style={styles.cardInfo}>
                <Text style={[styles.incType, { color: colors.foreground }]}>{item.type}</Text>
                <Text style={[styles.incDate, { color: colors.mutedForeground }]}>
                  {new Date(item.createdAt).toLocaleString()}
                </Text>
              </View>
              <StatusBadge status={item.synced ? "Verified" : "Pending"} small />
            </View>
            <Text style={[styles.incDesc, { color: colors.mutedForeground }]} numberOfLines={2}>
              {item.description}
            </Text>
            {item.location ? (
              <View style={styles.locRow}>
                <Feather name="map-pin" size={12} color={colors.mutedForeground} />
                <Text style={[styles.locText, { color: colors.mutedForeground }]}>{item.location}</Text>
              </View>
            ) : null}
          </View>
        )}
        scrollEnabled={true}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  header: { paddingHorizontal: 20, paddingBottom: 14, flexDirection: "row", justifyContent: "space-between", alignItems: "center", borderBottomWidth: 1 },
  title: { fontSize: 24, fontFamily: "Inter_700Bold" },
  headerActions: { flexDirection: "row", alignItems: "center", gap: 8 },
  syncBtn: { flexDirection: "row", alignItems: "center", gap: 5, paddingHorizontal: 10, paddingVertical: 6 },
  syncBtnText: { fontSize: 12, fontFamily: "Inter_600SemiBold" },
  addBtn: { flexDirection: "row", alignItems: "center", gap: 6, paddingHorizontal: 14, paddingVertical: 8 },
  addBtnText: { fontSize: 13, fontFamily: "Inter_600SemiBold", color: "#fff" },
  resultBanner: { margin: 16, flexDirection: "row", alignItems: "center", gap: 8, padding: 10, borderRadius: 8, borderWidth: 1 },
  resultText: { fontSize: 12, fontFamily: "Inter_500Medium", flex: 1 },
  list: { padding: 16, gap: 10 },
  card: { padding: 14, borderWidth: 1, marginBottom: 8, gap: 8 },
  cardTop: { flexDirection: "row", alignItems: "center", gap: 10 },
  iconWrap: { width: 40, height: 40, borderRadius: 12, alignItems: "center", justifyContent: "center" },
  cardInfo: { flex: 1, gap: 2 },
  incType: { fontSize: 14, fontFamily: "Inter_600SemiBold" },
  incDate: { fontSize: 12, fontFamily: "Inter_400Regular" },
  incDesc: { fontSize: 13, fontFamily: "Inter_400Regular", lineHeight: 18 },
  locRow: { flexDirection: "row", alignItems: "center", gap: 4 },
  locText: { fontSize: 12, fontFamily: "Inter_400Regular" },
});
