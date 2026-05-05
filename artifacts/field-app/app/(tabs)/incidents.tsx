import { Feather } from "@expo/vector-icons";
import AsyncStorage from "@react-native-async-storage/async-storage";
import * as Haptics from "expo-haptics";
import { useRouter } from "expo-router";
import React, { useCallback, useState } from "react";
import {
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

export interface Incident {
  id: string;
  type: string;
  description: string;
  location: string;
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

export default function IncidentsScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const [incidents, setIncidents] = useState<Incident[]>([]);
  const [refreshing, setRefreshing] = useState(false);

  const topPad = Platform.OS === "web" ? 67 : insets.top;

  const refresh = useCallback(async () => {
    setRefreshing(true);
    const data = await loadIncidents();
    setIncidents(data.sort((a, b) => b.createdAt.localeCompare(a.createdAt)));
    setRefreshing(false);
  }, []);

  React.useEffect(() => { refresh(); }, [refresh]);

  const incidentTypeIcon: Record<string, keyof typeof Feather.glyphMap> = {
    "Fraud Attempt": "alert-octagon",
    "System Issue": "cpu",
    "Stock Discrepancy": "package",
    "Farmer Dispute": "users",
    "Safety Concern": "shield",
    "Other": "flag",
  };

  return (
    <View style={[styles.root, { backgroundColor: colors.background }]}>
      <View style={[styles.header, { paddingTop: topPad + 12, backgroundColor: colors.background, borderBottomColor: colors.border }]}>
        <Text style={[styles.title, { color: colors.foreground }]}>Incidents</Text>
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
          <View style={[styles.card, { backgroundColor: colors.card, borderRadius: colors.radius, borderColor: colors.border }]}>
            <View style={styles.cardTop}>
              <View style={[styles.iconWrap, { backgroundColor: colors.warning + "18" }]}>
                <Feather
                  name={incidentTypeIcon[item.type] ?? "flag"}
                  size={18}
                  color={colors.warning}
                />
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
  addBtn: { flexDirection: "row", alignItems: "center", gap: 6, paddingHorizontal: 14, paddingVertical: 8 },
  addBtnText: { fontSize: 13, fontFamily: "Inter_600SemiBold", color: "#fff" },
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
