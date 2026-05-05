import { Feather } from "@expo/vector-icons";
import { useQuery } from "@tanstack/react-query";
import { useRouter } from "expo-router";
import React, { useState } from "react";
import {
  ActivityIndicator,
  FlatList,
  Platform,
  RefreshControl,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { StatusBadge } from "@/components/StatusBadge";
import { EmptyState } from "@/components/EmptyState";
import { useAuth } from "@/context/AuthContext";
import { useColors } from "@/hooks/useColors";
import { listDispatches, type Dispatch } from "@/lib/api";

function DispatchCard({ item, onPress }: { item: Dispatch; onPress: () => void }) {
  const colors = useColors();
  return (
    <TouchableOpacity
      style={[styles.card, { backgroundColor: colors.card, borderRadius: colors.radius, borderColor: colors.border }]}
      onPress={onPress}
      activeOpacity={0.8}
    >
      <View style={styles.cardTop}>
        <View>
          <Text style={[styles.manifest, { color: colors.primary }]}>{item.manifestCode}</Text>
          <Text style={[styles.dest, { color: colors.foreground }]}>
            {item.destinationCommunity ?? item.destinationDistrict ?? "—"}
          </Text>
        </View>
        <StatusBadge status={item.status} />
      </View>
      <View style={[styles.divider, { backgroundColor: colors.border }]} />
      <View style={styles.cardBottom}>
        <View style={styles.meta}>
          <Feather name="package" size={13} color={colors.mutedForeground} />
          <Text style={[styles.metaText, { color: colors.mutedForeground }]}>
            {item.totalPackages ?? 0} packages
          </Text>
        </View>
        {item.departureTime && (
          <View style={styles.meta}>
            <Feather name="calendar" size={13} color={colors.mutedForeground} />
            <Text style={[styles.metaText, { color: colors.mutedForeground }]}>
              {new Date(item.departureTime).toLocaleDateString()}
            </Text>
          </View>
        )}
        <Feather name="chevron-right" size={16} color={colors.mutedForeground} />
      </View>
    </TouchableOpacity>
  );
}

export default function DistributionsScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const { token } = useAuth();
  const router = useRouter();
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<string>("all");

  const { data, isLoading, refetch } = useQuery({
    queryKey: ["dispatches", "all"],
    queryFn: () => listDispatches(token!, { limit: "50" }),
    enabled: !!token,
  });

  const topPad = Platform.OS === "web" ? 67 : insets.top;

  const statusOptions = ["all", "Approved", "In Transit", "Delivered"];

  const filtered = (data?.data ?? []).filter((d) => {
    const matchSearch =
      !search ||
      d.manifestCode.toLowerCase().includes(search.toLowerCase()) ||
      (d.destinationDistrict ?? "").toLowerCase().includes(search.toLowerCase()) ||
      (d.destinationCommunity ?? "").toLowerCase().includes(search.toLowerCase());
    const matchStatus = statusFilter === "all" || d.status === statusFilter;
    return matchSearch && matchStatus;
  });

  return (
    <View style={[styles.root, { backgroundColor: colors.background }]}>
      {/* Header */}
      <View style={[styles.header, { paddingTop: topPad + 12, backgroundColor: colors.background, borderBottomColor: colors.border }]}>
        <Text style={[styles.title, { color: colors.foreground }]}>Distributions</Text>
        <View style={[styles.searchBar, { backgroundColor: colors.muted, borderRadius: colors.radius, borderColor: colors.border }]}>
          <Feather name="search" size={16} color={colors.mutedForeground} />
          <TextInput
            style={[styles.searchInput, { color: colors.foreground }]}
            placeholder="Search manifests..."
            placeholderTextColor={colors.mutedForeground}
            value={search}
            onChangeText={setSearch}
          />
          {search ? (
            <TouchableOpacity onPress={() => setSearch("")}>
              <Feather name="x" size={16} color={colors.mutedForeground} />
            </TouchableOpacity>
          ) : null}
        </View>
      </View>

      {/* Filter pills */}
      <View style={[styles.filters, { borderBottomColor: colors.border }]}>
        {statusOptions.map((s) => (
          <TouchableOpacity
            key={s}
            style={[
              styles.filterPill,
              { borderRadius: 20, backgroundColor: statusFilter === s ? colors.primary : colors.muted },
            ]}
            onPress={() => setStatusFilter(s)}
            activeOpacity={0.8}
          >
            <Text style={[styles.filterText, { color: statusFilter === s ? "#fff" : colors.mutedForeground }]}>
              {s === "all" ? "All" : s}
            </Text>
          </TouchableOpacity>
        ))}
      </View>

      {isLoading ? (
        <ActivityIndicator color={colors.primary} style={{ marginTop: 48 }} />
      ) : (
        <FlatList
          data={filtered}
          keyExtractor={(item) => item.id.toString()}
          renderItem={({ item }) => (
            <DispatchCard item={item} onPress={() => router.push(`/distribution/${item.id}`)} />
          )}
          contentContainerStyle={[styles.list, { paddingBottom: insets.bottom + 100 }]}
          refreshControl={<RefreshControl refreshing={isLoading} onRefresh={refetch} tintColor={colors.primary} />}
          ListEmptyComponent={
            <EmptyState
              icon="truck"
              title="No dispatches found"
              subtitle="Dispatches assigned to your district will appear here"
            />
          }
          scrollEnabled={true}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  header: { paddingHorizontal: 20, paddingBottom: 12, gap: 12, borderBottomWidth: 1 },
  title: { fontSize: 24, fontFamily: "Inter_700Bold" },
  searchBar: { flexDirection: "row", alignItems: "center", gap: 10, paddingHorizontal: 12, height: 44, borderWidth: 1 },
  searchInput: { flex: 1, fontSize: 14, fontFamily: "Inter_400Regular" },
  filters: { flexDirection: "row", gap: 8, paddingHorizontal: 20, paddingVertical: 12, borderBottomWidth: 1 },
  filterPill: { paddingHorizontal: 14, paddingVertical: 6 },
  filterText: { fontSize: 13, fontFamily: "Inter_500Medium" },
  list: { padding: 16, gap: 10 },
  card: { padding: 14, borderWidth: 1, marginBottom: 8 },
  cardTop: { flexDirection: "row", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 10 },
  manifest: { fontSize: 15, fontFamily: "Inter_600SemiBold" },
  dest: { fontSize: 13, fontFamily: "Inter_400Regular", marginTop: 2 },
  divider: { height: 1, marginBottom: 10 },
  cardBottom: { flexDirection: "row", alignItems: "center", gap: 14 },
  meta: { flexDirection: "row", alignItems: "center", gap: 5, flex: 1 },
  metaText: { fontSize: 12, fontFamily: "Inter_400Regular" },
});
