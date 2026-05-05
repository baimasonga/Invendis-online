import {
  Inter_400Regular,
  Inter_500Medium,
  Inter_600SemiBold,
  Inter_700Bold,
  useFonts,
} from "@expo-google-fonts/inter";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Stack, useRouter, useSegments } from "expo-router";
import * as SplashScreen from "expo-splash-screen";
import React, { useEffect } from "react";
import { ActivityIndicator, View } from "react-native";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import { KeyboardProvider } from "react-native-keyboard-controller";
import { SafeAreaProvider } from "react-native-safe-area-context";

import { ErrorBoundary } from "@/components/ErrorBoundary";
import { AuthProvider, useAuth } from "@/context/AuthContext";
import { OfflineQueueProvider } from "@/context/OfflineQueueContext";

SplashScreen.preventAutoHideAsync();

const queryClient = new QueryClient();

function AuthGuard() {
  const { token, isLoading } = useAuth();
  const router = useRouter();
  const segments = useSegments();

  useEffect(() => {
    if (isLoading) return;
    const onLogin = segments[0] === "login";

    if (!token && !onLogin) {
      router.replace("/login");
    } else if (token && (onLogin || segments.length === 0)) {
      router.replace("/(tabs)/");
    }
  }, [token, isLoading, segments]);

  if (isLoading) {
    return (
      <View style={{ flex: 1, alignItems: "center", justifyContent: "center", backgroundColor: "#126d34" }}>
        <ActivityIndicator color="#ffffff" size="large" />
      </View>
    );
  }

  return (
    <Stack screenOptions={{ headerBackTitle: "Back", headerTintColor: "#126d34" }}>
      <Stack.Screen name="login" options={{ headerShown: false }} />
      <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
      <Stack.Screen
        name="distribution/[id]"
        options={{ title: "Distribution Detail", headerBackTitle: "Back" }}
      />
      <Stack.Screen
        name="scan-farmer"
        options={{ title: "Find Farmer", headerBackTitle: "Back" }}
      />
      <Stack.Screen
        name="confirm-pod"
        options={{ title: "Confirm Issue", headerBackTitle: "Back" }}
      />
      <Stack.Screen
        name="incident/new"
        options={{ title: "Report Incident", headerBackTitle: "Back" }}
      />
    </Stack>
  );
}

export default function RootLayout() {
  const [fontsLoaded, fontError] = useFonts({
    Inter_400Regular,
    Inter_500Medium,
    Inter_600SemiBold,
    Inter_700Bold,
    // Load Feather icon font from local assets so Metro bundles it for both web and native
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    feather: require("../assets/fonts/Feather.ttf") as string,
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    Feather: require("../assets/fonts/Feather.ttf") as string,
  });

  useEffect(() => {
    if (fontsLoaded || fontError) {
      SplashScreen.hideAsync();
    }
  }, [fontsLoaded, fontError]);

  if (!fontsLoaded && !fontError) return null;

  return (
    <SafeAreaProvider>
      <ErrorBoundary>
        <QueryClientProvider client={queryClient}>
          <AuthProvider>
            <OfflineQueueProvider>
              <GestureHandlerRootView style={{ flex: 1 }}>
                <KeyboardProvider>
                  <AuthGuard />
                </KeyboardProvider>
              </GestureHandlerRootView>
            </OfflineQueueProvider>
          </AuthProvider>
        </QueryClientProvider>
      </ErrorBoundary>
    </SafeAreaProvider>
  );
}
