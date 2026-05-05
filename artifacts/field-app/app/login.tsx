import { Feather } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import { useRouter } from "expo-router";
import React, { useState } from "react";
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useAuth } from "@/context/AuthContext";
import { useColors } from "@/hooks/useColors";

export default function LoginScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const { login } = useAuth();
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [showPass, setShowPass] = useState(false);

  const handleLogin = async () => {
    if (!email.trim() || !password.trim()) {
      setError("Please enter your email and password");
      return;
    }
    setError("");
    setLoading(true);
    try {
      await login(email.trim().toLowerCase(), password);
      await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      router.replace("/(tabs)/");
    } catch (e: unknown) {
      await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
      setError(e instanceof Error ? e.message : "Login failed");
    } finally {
      setLoading(false);
    }
  };

  return (
    <View style={[styles.root, { backgroundColor: colors.primary }]}>
      <KeyboardAvoidingView
        behavior={Platform.OS === "ios" ? "padding" : undefined}
        style={{ flex: 1 }}
      >
        <ScrollView
          contentContainerStyle={[styles.scroll, { paddingTop: insets.top + 48, paddingBottom: insets.bottom + 32 }]}
          keyboardShouldPersistTaps="handled"
        >
          {/* Brand */}
          <View style={styles.brand}>
            <View style={[styles.logoWrap, { backgroundColor: "rgba(255,255,255,0.15)" }]}>
              <Feather name="activity" size={36} color="#ffffff" />
            </View>
            <Text style={styles.appName}>Invendis</Text>
            <Text style={styles.tagline}>Field Operations</Text>
          </View>

          {/* Card */}
          <View style={[styles.card, { backgroundColor: colors.card, borderRadius: colors.radius * 2 }]}>
            <Text style={[styles.heading, { color: colors.foreground }]}>Sign In</Text>
            <Text style={[styles.sub, { color: colors.mutedForeground }]}>
              Use your Invendis account email and password
            </Text>

            {error ? (
              <View style={[styles.errorBox, { backgroundColor: colors.destructive + "18", borderRadius: colors.radius }]}>
                <Feather name="alert-circle" size={14} color={colors.destructive} />
                <Text style={[styles.errorText, { color: colors.destructive }]}>{error}</Text>
              </View>
            ) : null}

            <View style={styles.fields}>
              <View>
                <Text style={[styles.label, { color: colors.mutedForeground }]}>Email</Text>
                <TextInput
                  style={[styles.input, { borderColor: colors.border, backgroundColor: colors.muted, color: colors.foreground, borderRadius: colors.radius }]}
                  value={email}
                  onChangeText={setEmail}
                  placeholder="Enter email address"
                  placeholderTextColor={colors.mutedForeground}
                  autoCapitalize="none"
                  autoCorrect={false}
                  keyboardType="email-address"
                  textContentType="emailAddress"
                  returnKeyType="next"
                />
              </View>

              <View>
                <Text style={[styles.label, { color: colors.mutedForeground }]}>Password</Text>
                <View style={[styles.passWrap, { borderColor: colors.border, backgroundColor: colors.muted, borderRadius: colors.radius }]}>
                  <TextInput
                    style={[styles.passInput, { color: colors.foreground }]}
                    value={password}
                    onChangeText={setPassword}
                    placeholder="Enter password"
                    placeholderTextColor={colors.mutedForeground}
                    secureTextEntry={!showPass}
                    textContentType="password"
                    returnKeyType="done"
                    onSubmitEditing={handleLogin}
                  />
                  <TouchableOpacity onPress={() => setShowPass((v) => !v)} style={styles.eyeBtn}>
                    <Feather name={showPass ? "eye-off" : "eye"} size={18} color={colors.mutedForeground} />
                  </TouchableOpacity>
                </View>
              </View>
            </View>

            <TouchableOpacity
              style={[styles.btn, { backgroundColor: colors.primary, borderRadius: colors.radius, opacity: loading ? 0.7 : 1 }]}
              onPress={handleLogin}
              disabled={loading}
              activeOpacity={0.85}
            >
              {loading ? (
                <ActivityIndicator color="#ffffff" />
              ) : (
                <Text style={styles.btnText}>Sign In</Text>
              )}
            </TouchableOpacity>
          </View>

          <Text style={styles.footer}>Agri-PoD · Sierra Leone</Text>
        </ScrollView>
      </KeyboardAvoidingView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  scroll: { flexGrow: 1, paddingHorizontal: 24 },
  brand: { alignItems: "center", marginBottom: 32, gap: 8 },
  logoWrap: { width: 80, height: 80, borderRadius: 24, alignItems: "center", justifyContent: "center", marginBottom: 4 },
  appName: { fontSize: 32, fontFamily: "Inter_700Bold", color: "#ffffff", letterSpacing: -0.5 },
  tagline: { fontSize: 14, fontFamily: "Inter_400Regular", color: "rgba(255,255,255,0.7)" },
  card: { padding: 24, gap: 16, elevation: 8 },
  heading: { fontSize: 22, fontFamily: "Inter_700Bold" },
  sub: { fontSize: 14, fontFamily: "Inter_400Regular", marginTop: -8 },
  errorBox: { flexDirection: "row", alignItems: "center", gap: 8, padding: 10 },
  errorText: { fontSize: 13, fontFamily: "Inter_400Regular", flex: 1 },
  fields: { gap: 14 },
  label: { fontSize: 12, fontFamily: "Inter_500Medium", marginBottom: 6, letterSpacing: 0.3 },
  input: { height: 48, paddingHorizontal: 14, fontSize: 15, fontFamily: "Inter_400Regular", borderWidth: 1 },
  passWrap: { height: 48, flexDirection: "row", alignItems: "center", borderWidth: 1 },
  passInput: { flex: 1, paddingHorizontal: 14, fontSize: 15, fontFamily: "Inter_400Regular" },
  eyeBtn: { paddingHorizontal: 14 },
  btn: { height: 50, alignItems: "center", justifyContent: "center", marginTop: 4 },
  btnText: { fontSize: 15, fontFamily: "Inter_600SemiBold", color: "#ffffff" },
  footer: { textAlign: "center", marginTop: 24, fontSize: 12, color: "rgba(255,255,255,0.5)", fontFamily: "Inter_400Regular" },
});
