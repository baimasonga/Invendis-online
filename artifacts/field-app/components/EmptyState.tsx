import { Feather } from "@expo/vector-icons";
import React from "react";
import { StyleSheet, Text, TouchableOpacity, View } from "react-native";
import { useColors } from "@/hooks/useColors";

interface Props {
  icon: keyof typeof Feather.glyphMap;
  title: string;
  subtitle?: string;
  actionLabel?: string;
  onAction?: () => void;
}

export function EmptyState({ icon, title, subtitle, actionLabel, onAction }: Props) {
  const colors = useColors();
  return (
    <View style={styles.container}>
      <View style={[styles.iconWrap, { backgroundColor: colors.muted, borderRadius: 40 }]}>
        <Feather name={icon} size={32} color={colors.mutedForeground} />
      </View>
      <Text style={[styles.title, { color: colors.foreground }]}>{title}</Text>
      {subtitle && <Text style={[styles.subtitle, { color: colors.mutedForeground }]}>{subtitle}</Text>}
      {actionLabel && onAction && (
        <TouchableOpacity
          style={[styles.action, { backgroundColor: colors.primary, borderRadius: colors.radius }]}
          onPress={onAction}
          activeOpacity={0.8}
        >
          <Text style={[styles.actionText, { color: colors.primaryForeground }]}>{actionLabel}</Text>
        </TouchableOpacity>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, alignItems: "center", justifyContent: "center", padding: 32, gap: 12 },
  iconWrap: { width: 80, height: 80, alignItems: "center", justifyContent: "center", marginBottom: 4 },
  title: { fontSize: 17, fontFamily: "Inter_600SemiBold", textAlign: "center" },
  subtitle: { fontSize: 14, fontFamily: "Inter_400Regular", textAlign: "center", lineHeight: 20 },
  action: { marginTop: 8, paddingHorizontal: 20, paddingVertical: 10 },
  actionText: { fontSize: 14, fontFamily: "Inter_600SemiBold" },
});
