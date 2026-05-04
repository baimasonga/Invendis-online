import React from "react";
import { StyleSheet, Text, View } from "react-native";
import { useColors } from "@/hooks/useColors";

type Status =
  | "Draft" | "Submitted" | "Approved" | "Active" | "Completed" | "Cancelled"
  | "In Transit" | "Delivered" | "Pending" | "Verified" | "pending" | "approved"
  | "rejected" | "failed" | string;

interface Props {
  status: Status;
  small?: boolean;
}

function getStatusColor(status: string, colors: ReturnType<typeof useColors>) {
  const s = status.toLowerCase();
  if (s === "verified" || s === "approved" || s === "active" || s === "delivered" || s === "completed") {
    return { bg: colors.success + "22", text: colors.success };
  }
  if (s === "pending" || s === "submitted" || s === "in transit") {
    return { bg: colors.info + "22", text: colors.info };
  }
  if (s === "draft") {
    return { bg: colors.mutedForeground + "22", text: colors.mutedForeground };
  }
  if (s === "rejected" || s === "cancelled" || s === "failed") {
    return { bg: colors.destructive + "22", text: colors.destructive };
  }
  return { bg: colors.secondary + "22", text: colors.secondary };
}

export function StatusBadge({ status, small }: Props) {
  const colors = useColors();
  const { bg, text } = getStatusColor(status, colors);

  return (
    <View style={[styles.badge, { backgroundColor: bg, borderRadius: colors.radius }]}>
      <Text style={[styles.text, { color: text, fontSize: small ? 10 : 11 }]}>
        {status.toUpperCase()}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  badge: {
    paddingHorizontal: 8,
    paddingVertical: 3,
    alignSelf: "flex-start",
  },
  text: {
    fontFamily: "Inter_600SemiBold",
    letterSpacing: 0.5,
  },
});
