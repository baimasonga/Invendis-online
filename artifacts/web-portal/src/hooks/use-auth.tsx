import { createContext, useContext, useState, useEffect } from "react";
import { useLogin, useLogout, useGetMe, getGetMeQueryKey } from "@workspace/api-client-react";
import type { UserProfile, LoginBody } from "@workspace/api-client-react";
import { useLocation } from "wouter";

interface AuthContextType {
  user: UserProfile | null;
  isLoading: boolean;
  login: (credentials: LoginBody) => Promise<void>;
  logout: () => void;
  isAuthenticated: boolean;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<UserProfile | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [_, setLocation] = useLocation();

  const { data: meData, isLoading: meLoading, error: meError } = useGetMe({
    query: {
      queryKey: getGetMeQueryKey(),
      retry: false,
      refetchOnWindowFocus: false,
    }
  });

  const loginMutation = useLogin();
  const logoutMutation = useLogout();

  useEffect(() => {
    if (!meLoading) {
      if (meData) {
        setUser(meData);
      } else {
        setUser(null);
      }
      setIsLoading(false);
    }
  }, [meData, meLoading, meError]);

  const handleLogin = async (credentials: LoginBody) => {
    try {
      const response = await loginMutation.mutateAsync({ data: credentials });
      localStorage.setItem("token", response.token);
      setUser(response.user);
      setLocation("/dashboard");
    } catch (error) {
      throw error;
    }
  };

  const handleLogout = async () => {
    try {
      await logoutMutation.mutateAsync();
    } catch (e) {
      // Ignore
    } finally {
      localStorage.removeItem("token");
      setUser(null);
      setLocation("/login");
    }
  };

  return (
    <AuthContext.Provider
      value={{
        user,
        isLoading,
        login: handleLogin,
        logout: handleLogout,
        isAuthenticated: !!user,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (context === undefined) {
    throw new Error("useAuth must be used within an AuthProvider");
  }
  return context;
}
