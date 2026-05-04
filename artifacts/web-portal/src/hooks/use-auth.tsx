import { createContext, useContext, useState, useEffect, useRef } from "react";
import { supabase } from "@/lib/supabase";
import { useLocation } from "wouter";

export interface UserProfile {
  id: string;
  fullName: string;
  email: string;
  role: string;
  districtId?: number | null;
  isActive: boolean;
}

interface AuthContextType {
  user: UserProfile | null;
  isLoading: boolean;
  login: (credentials: { email: string; password: string }) => Promise<void>;
  logout: () => void;
  isAuthenticated: boolean;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

async function fetchProfile(userId: string): Promise<UserProfile | null> {
  try {
    const { data, error } = await supabase
      .from("profiles")
      .select("id, full_name, email, role, district_id, is_active")
      .eq("id", userId)
      .single();
    if (error || !data) return null;
    return {
      id: data.id,
      fullName: data.full_name ?? "",
      email: data.email ?? "",
      role: data.role ?? "FieldOfficer",
      districtId: data.district_id,
      isActive: data.is_active ?? true,
    };
  } catch {
    return null;
  }
}

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<UserProfile | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [, setLocation] = useLocation();
  const initialised = useRef(false);

  useEffect(() => {
    // Safety timeout: never stay loading more than 8 seconds
    const timeout = setTimeout(() => setIsLoading(false), 8000);

    // onAuthStateChange fires INITIAL_SESSION first (replaces getSession()),
    // then SIGNED_IN / SIGNED_OUT for subsequent changes.
    const { data: { subscription } } = supabase.auth.onAuthStateChange(
      async (event, session) => {
        if (event === "INITIAL_SESSION") {
          if (session?.user) {
            const profile = await fetchProfile(session.user.id);
            setUser(profile);
          }
          clearTimeout(timeout);
          setIsLoading(false);
          initialised.current = true;
        } else if (event === "SIGNED_IN" && session?.user) {
          const profile = await fetchProfile(session.user.id);
          setUser(profile);
          if (!initialised.current) {
            clearTimeout(timeout);
            setIsLoading(false);
            initialised.current = true;
          }
        } else if (event === "SIGNED_OUT") {
          setUser(null);
          clearTimeout(timeout);
          setIsLoading(false);
        }
      }
    );

    return () => {
      clearTimeout(timeout);
      subscription.unsubscribe();
    };
  }, []);

  const login = async ({ email, password }: { email: string; password: string }) => {
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) throw new Error(error.message);
  };

  const logout = async () => {
    await supabase.auth.signOut();
    setUser(null);
    setLocation("/login");
  };

  return (
    <AuthContext.Provider value={{ user, isLoading, login, logout, isAuthenticated: !!user }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
}
