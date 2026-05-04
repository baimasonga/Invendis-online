import { Feather } from "@expo/vector-icons";
import AsyncStorage from "@react-native-async-storage/async-storage";
import * as Haptics from "expo-haptics";
import { useRouter } from "expo-router";
import React, { useState } from "react";
import {
  Alert,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useColors } from "@/hooks/useColors";
import type { Incident } from "@/app/(tabs)/incidents";

const INCIDENTS_KEY = "@incidents";
const INCIDENT_TYPES = [
  "Fraud Attempt",
  "Stock Discrepancy",
  "Farmer Dispute",
  "System Issue",
  "Safety Concern",
  "Other",
];

export default function NewIncidentScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const [type, setType] = useState<string>("");
  const [description, setDescription] = useState("");
  const [location, setLocation] = useState("");
  const [saving, setSaving] = useState(false);
  const bottomPad = Platform.OS === "web" ? 34 : insets.bottom;

  const handleSave = async () => {
    if (!type) { Alert.alert("Required", "Please select an incident type."); return; }
    if (!description.trim()) { Alert.alert("Required", "Please describe the incident."); return; }
    setSaving(true);
    try {
      const stored = await AsyncStorage.getItem(INCIDENTS_KEY);
      const existing: Incident[] = stored ? JSON.parse(stored) : [];
      const newIncident: Incident = {
        id: Date.now().toString() + Math.random().toString(36).substr(2, 6),
        type,
        description: description.trim(),
        location: location.trim(),
        createdAt: new Date().toISOString(),
        synced: false,
      };
      await AsyncStorage.setItem(INCIDENTS_KEY, JSON.stringify([...existing, newIncident]));
      await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      Alert.alert("Reported", "Incident saved successfully.", [
        { text: "OK", onPress: () => router.back() },
      ]);
    } catch {
      Alert.alert("Error", "Could not save incident. Try again.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <ScrollView
      style={[styles.root, { backgroundColor: colors.background }]}
      contentContainerStyle={[styles.content, { paddingBottom: bottomPad + 32 }]}
      keyboardShouldPersistTaps="handled"
    >
      {/* Type selector */}
      <View style={[styles.section, { backgroundColor: colors.card, borderColor: colors.border, borderRadius: colors.radius }]}>
        <Text style={[styles.label, { color: colors.mutedForeground }]}>Incident Type</Text>
        <View style={styles.typeGrid}>
          {INCIDENT_TYPES.map((t) => (
            <TouchableOpacity
              key={t}
              style={[
                styles.typePill,
                {
                  borderRadius: colors.radius,
                  backgroundColor: type === t ? colors.primary : colors.muted,
                  borderColor: type === t ? colors.primary : colors.border,
                },
              ]}
              onPress={() => setType(t)}
              activeOpacity={0.8}
            >
              <Text style={[styles.typePillText, { color: type === t ? "#fff" : colors.mutedForeground }]}>{t}</Text>
            </TouchableOpacity>
          ))}
        </View>
      </View>

      {/* Description */}
      <View style={[styles.section, { backgroundColor: colors.card, borderColor: colors.border, borderRadius: colors.radius }]}>
        <Text style={[styles.label, { color: colors.mutedForeground }]}>Description</Text>
        <TextInput
          style={[styles.textarea, { borderColor: colors.border, backgroundColor: colors.muted, color: colors.foreground, borderRadius: colors.radius }]}
          value={description}
          onChangeText={setDescription}
          placeholder="Describe what happened…"
          placeholderTextColor={colors.mutedForeground}
          multiline
          numberOfLines={5}
          textAlignVertical="top"
        />
      </View>

      {/* Location */}
      <View style={[styles.section, { backgroundColor: colors.card, borderColor: colors.border, borderRadius: colors.radius }]}>
        <Text style={[styles.label, { color: colors.mutedForeground }]}>Location (optional)</Text>
        <TextInput
          style={[styles.inputField, { borderColor: colors.border, backgroundColor: colors.muted, color: colors.foreground, borderRadius: colors.radius }]}
          value={location}
          onChangeText={setLocation}
          placeholder="Village / chiefdom name…"
          placeholderTextColor={colors.mutedForeground}
        />
      </View>

      {/* Severity indicator */}
      {type === "Fraud Attempt" || type === "Safety Concern" ? (
        <View style={[styles.warningBox, { backgroundColor: colors.destructive + "12", borderColor: colors.destructive + "40", borderRadius: colors.radius }]}>
          <Feather name="alert-triangle" size={16} color={colors.destructive} />
          <Text style={[styles.warningText, { color: colors.destructive }]}>
            This is a high-priority incident. It will be escalated to your supervisor.
          </Text>
        </View>
      ) : null}

      <TouchableOpacity
        style={[styles.saveBtn, { backgroundColor: colors.primary, borderRadius: colors.radius, opacity: saving ? 0.7 : 1 }]}
        onPress={handleSave}
        disabled={saving}
        activeOpacity={0.85}
      >
        <Feather name="flag" size={18} color="#fff" />
        <Text style={styles.saveBtnText}>Submit Report</Text>
      </TouchableOpacity>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  content: { padding: 16, gap: 12 },
  section: { padding: 16, gap: 10, borderWidth: 1 },
  label: { fontSize: 11, fontFamily: "Inter_500Medium", textTransform: "uppercase", letterSpacing: 0.8 },
  typeGrid: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  typePill: { paddingHorizontal: 14, paddingVertical: 8, borderWidth: 1 },
  typePillText: { fontSize: 13, fontFamily: "Inter_500Medium" },
  textarea: { padding: 12, fontSize: 14, fontFamily: "Inter_400Regular", borderWidth: 1, minHeight: 120 },
  inputField: { height: 48, paddingHorizontal: 12, fontSize: 14, fontFamily: "Inter_400Regular", borderWidth: 1 },
  warningBox: { flexDirection: "row", alignItems: "flex-start", gap: 10, padding: 12, borderWidth: 1 },
  warningText: { flex: 1, fontSize: 13, fontFamily: "Inter_400Regular", lineHeight: 18 },
  saveBtn: { height: 52, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 10, marginTop: 8 },
  saveBtnText: { color: "#fff", fontFamily: "Inter_600SemiBold", fontSize: 15 },
});
