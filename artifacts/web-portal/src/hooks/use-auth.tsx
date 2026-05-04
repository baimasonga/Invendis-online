import { createContext, useContext, useState, useEffect } from "react";
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

  useEffect(() => {
    // Safety net: never stay stuck loading beyond 10 seconds
    const safetyTimeout = setTimeout(() => setIsLoading(false), 10000);

    const { data: { subscription } } = supabase.auth.onAuthStateChange(
      (event, session) => {
        // IMPORTANT: keep this callback synchronous — no async/await here.
        // Supabase holds an internal lock during this callback; any awaited
        // network call inside it will deadlock subsequent auth operations
        // (e.g. signInWithPassword). Defer all async work via setTimeout.
        if (event === "SIGNED_OUT" || !session?.user) {
          setUser(null);
          clearTimeout(safetyTimeout);
          setIsLoading(false);
          return;
        }

        const userId = session.user.id;
        setTimeout(() => {
          fetchProfile(userId)
            .then((profile) => {
              setUser(profile);
            })
            .catch(() => {
              setUser(null);
            })
            .finally(() => {
              clearTimeout(safetyTimeout);
              setIsLoading(false);
            });
        }, 0);
      }
    );

    return () => {
      clearTimeout(safetyTimeout);
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
