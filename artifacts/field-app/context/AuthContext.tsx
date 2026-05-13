import AsyncStorage from "@react-native-async-storage/async-storage";
import React, { createContext, useContext, useEffect, useState } from "react";

export interface AuthUser {
  id: number;
  username: string;
  fullName: string;
  email: string;
  role: string;
  districtId: number | null;
}

interface AuthContextType {
  user: AuthUser | null;
  token: string | null;
  isLoading: boolean;
  login: (email: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType | null>(null);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [token, setToken] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    (async () => {
      try {
        const stored = await AsyncStorage.getItem("@auth");
        if (stored) {
          const parsed = JSON.parse(stored);
          setUser(parsed.user);
          setToken(parsed.token);
        }
      } catch {}
      finally {
        setIsLoading(false);
      }
    })();
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
    const data = (await res.json()) as { token: string; user: AuthUser };
    await AsyncStorage.setItem("@auth", JSON.stringify({ user: data.user, token: data.token }));
    setUser(data.user);
    setToken(data.token);
  };

  const logout = async () => {
    await AsyncStorage.removeItem("@auth");
    setUser(null);
    setToken(null);
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
