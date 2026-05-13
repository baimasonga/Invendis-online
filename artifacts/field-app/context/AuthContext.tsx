import * as SecureStore from "expo-secure-store";
import React, { createContext, useContext, useEffect, useState } from "react";
import { Platform } from "react-native";
import { z } from "zod";
import { setUnauthorizedHandler } from "@/lib/api";

export interface AuthUser {
  id: number;
  username: string;
  fullName: string;
  email: string;
  role: string;
  districtId: number | null;
}

const LoginResponseSchema = z.object({
  token: z.string().min(1),
  user: z.object({
    id: z.number(),
    username: z.string(),
    fullName: z.string(),
    email: z.string(),
    role: z.string(),
    districtId: z.number().nullable(),
  }),
});

interface AuthContextType {
  user: AuthUser | null;
  token: string | null;
  isLoading: boolean;
  login: (email: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
}

const AUTH_KEY = "invendis_auth";
const STORE_KEY = "@auth"; // fallback key for web (localStorage via AsyncStorage)

async function secureRead(key: string): Promise<string | null> {
  if (Platform.OS === "web") {
    try {
      const { default: AsyncStorage } = await import("@react-native-async-storage/async-storage");
      return AsyncStorage.getItem(key);
    } catch { return null; }
  }
  return SecureStore.getItemAsync(key);
}

async function secureWrite(key: string, value: string): Promise<void> {
  if (Platform.OS === "web") {
    const { default: AsyncStorage } = await import("@react-native-async-storage/async-storage");
    return AsyncStorage.setItem(key, value);
  }
  return SecureStore.setItemAsync(key, value);
}

async function secureDelete(key: string): Promise<void> {
  if (Platform.OS === "web") {
    const { default: AsyncStorage } = await import("@react-native-async-storage/async-storage");
    return AsyncStorage.removeItem(key);
  }
  return SecureStore.deleteItemAsync(key);
}

const AuthContext = createContext<AuthContextType | null>(null);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [token, setToken] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  const logout = async () => {
    await secureDelete(AUTH_KEY);
    setUser(null);
    setToken(null);
  };

  useEffect(() => {
    // Wire auto-logout when any API call gets a 401
    setUnauthorizedHandler(logout);

    (async () => {
      try {
        const stored = await secureRead(AUTH_KEY);
        if (stored) {
          const parsed = JSON.parse(stored);
          setUser(parsed.user);
          setToken(parsed.token);
        }
      } catch {
        // Corrupted storage — clear it
        await secureDelete(AUTH_KEY).catch(() => {});
      } finally {
        setIsLoading(false);
      }
    })();
  // logout is stable (defined outside state), intentionally omitted from deps
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const login = async (email: string, password: string) => {
    const domain = process.env.EXPO_PUBLIC_DOMAIN;
    if (!domain) throw new Error("EXPO_PUBLIC_DOMAIN is not configured");
    const res = await fetch(`https://${domain}/api/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, password }),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error((err as { message?: string }).message ?? "Login failed");
    }
    const raw = await res.json();
    const parsed = LoginResponseSchema.safeParse(raw);
    if (!parsed.success) throw new Error("Unexpected response from server");
    const { token: tok, user: usr } = parsed.data;
    await secureWrite(AUTH_KEY, JSON.stringify({ user: usr, token: tok }));
    setUser(usr);
    setToken(tok);
  };

  return (
    <AuthContext.Provider value={{ user, token, isLoading, login, logout }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
}
