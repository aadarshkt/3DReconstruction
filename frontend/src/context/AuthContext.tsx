"use client";

import React, { createContext, useContext, useEffect, useState, useCallback } from "react";
import { useRouter } from "next/navigation";

export interface UserProfile {
  id: string;
  email: string;
  full_name: string | null;
  role: "admin" | "user";
  avatar_url?: string | null;
  oauth_provider?: string;
  created_at?: string;
}

interface AuthContextType {
  user: UserProfile | null;
  token: string | null;
  loading: boolean;
  isAdmin: boolean;
  isUser: boolean;
  loginWithGoogle: () => Promise<void>;
  loginDev: (role: "admin" | "user", email?: string, name?: string) => Promise<void>;
  setSession: (token: string, user: UserProfile) => void;
  logout: () => Promise<void>;
  refreshUser: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

const TOKEN_KEY = "claimspace_auth_token";
const USER_KEY = "claimspace_auth_user";

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<UserProfile | null>(null);
  const [token, setToken] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const router = useRouter();

  const setSession = useCallback((newToken: string, newUser: UserProfile) => {
    setToken(newToken);
    setUser(newUser);
    try {
      localStorage.setItem(TOKEN_KEY, newToken);
      localStorage.setItem(USER_KEY, JSON.stringify(newUser));
      // Also set standard cookies so Next.js middleware and SSR can inspect
      document.cookie = `auth_token=${newToken}; path=/; max-age=604800; SameSite=Lax`;
      document.cookie = `user_role=${newUser.role}; path=/; max-age=604800; SameSite=Lax`;
    } catch {
      // Ignore localStorage issues in private mode
    }
  }, []);

  const clearSession = useCallback(() => {
    setToken(null);
    setUser(null);
    try {
      localStorage.removeItem(TOKEN_KEY);
      localStorage.removeItem(USER_KEY);
      document.cookie = "auth_token=; path=/; expires=Thu, 01 Jan 1970 00:00:00 GMT";
      document.cookie = "user_role=; path=/; expires=Thu, 01 Jan 1970 00:00:00 GMT";
    } catch {
      // Ignore
    }
  }, []);

  // Fetch current user details from backend using Bearer token
  const refreshUser = useCallback(async () => {
    const currentToken = token || (typeof window !== "undefined" ? localStorage.getItem(TOKEN_KEY) : null);
    if (!currentToken) {
      setLoading(false);
      return;
    }

    try {
      const res = await fetch("/api/v1/auth/me", {
        headers: {
          Authorization: `Bearer ${currentToken}`,
        },
      });

      if (res.ok) {
        const userData: UserProfile = await res.json();
        setUser(userData);
        setToken(currentToken);
        localStorage.setItem(USER_KEY, JSON.stringify(userData));
        document.cookie = `user_role=${userData.role}; path=/; max-age=604800; SameSite=Lax`;
      } else {
        clearSession();
      }
    } catch (err) {
      console.error("Failed to verify user session:", err);
    } finally {
      setLoading(false);
    }
  }, [token, clearSession]);

  // Initial session hydration
  useEffect(() => {
    try {
      const savedToken = localStorage.getItem(TOKEN_KEY);
      const savedUser = localStorage.getItem(USER_KEY);
      if (savedToken && savedUser) {
        setToken(savedToken);
        setUser(JSON.parse(savedUser));
      }
    } catch {
      // Ignore
    }
    refreshUser();
  }, [refreshUser]);

  // Initiate Google OAuth Flow
  const loginWithGoogle = async () => {
    try {
      const redirectUri = `${window.location.origin}/auth/callback`;
      const res = await fetch(`/api/v1/auth/google/url?redirect_uri=${encodeURIComponent(redirectUri)}`);
      const data = await res.json();

      if (data.configured && data.url) {
        window.location.href = data.url;
      } else {
        alert(
          "Google OAuth credentials (GOOGLE_CLIENT_ID) are not yet configured in backend .env.\n\nYou can use the instant 1-Click Role Login buttons below to test both Admin and User roles!"
        );
      }
    } catch (err) {
      console.error("OAuth URL request failed:", err);
      alert("Failed to initiate Google OAuth. Please check server connectivity.");
    }
  };

  // Developer 1-Click login for testing roles
  const loginDev = async (role: "admin" | "user", email?: string, name?: string) => {
    setLoading(true);
    try {
      const defaultEmail = role === "admin" ? "admin@claimspace.com" : "policyholder@example.com";
      const defaultName = role === "admin" ? "Admin Inspector" : "Sarah Jenkins";

      const res = await fetch("/api/v1/auth/dev-login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email: email || defaultEmail,
          name: name || defaultName,
          role: role,
        }),
      });

      if (!res.ok) {
        const errorText = await res.text();
        throw new Error(errorText || "Dev login failed");
      }

      const data = await res.json();
      setSession(data.access_token, data.user);

      // Role-based redirection
      if (data.user.role === "admin") {
        router.push("/admin");
      } else {
        router.push("/portal");
      }
    } catch (err) {
      console.error("Dev login failed:", err);
      alert("Login failed: " + (err as Error).message);
    } finally {
      setLoading(false);
    }
  };

  const logout = async () => {
    try {
      await fetch("/api/v1/auth/logout", { method: "POST" });
    } catch {
      // Ignore
    }
    clearSession();
    router.push("/");
  };

  const isAdmin = user?.role === "admin";
  const isUser = user?.role === "user";

  return (
    <AuthContext.Provider
      value={{
        user,
        token,
        loading,
        isAdmin,
        isUser,
        loginWithGoogle,
        loginDev,
        setSession,
        logout,
        refreshUser,
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
