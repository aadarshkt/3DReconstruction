"use client";

import React, { useEffect, useState, Suspense } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useAuth } from "@/context/AuthContext";
import Navbar from "@/components/Navbar";

function CallbackContent() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const { setSession } = useAuth();
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState("Verifying credentials with Google...");

  useEffect(() => {
    const code = searchParams.get("code");
    const errorParam = searchParams.get("error");

    if (errorParam) {
      setError(`Google Authentication Error: ${errorParam}`);
      return;
    }

    if (!code) {
      setError("No authorization code provided in callback.");
      return;
    }

    const exchangeCode = async () => {
      try {
        setStatus("Exchanging authorization code and issuing signed JWT session...");
        const redirectUri = `${window.location.origin}/auth/callback`;

        const res = await fetch("/api/v1/auth/google/callback", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ code, redirect_uri: redirectUri }),
        });

        if (!res.ok) {
          const errData = await res.json().catch(() => ({ detail: "Exchange failed" }));
          throw new Error(errData.detail || "Authentication exchange failed.");
        }

        const data = await res.json();
        setSession(data.access_token, data.user);
        setStatus("Authentication verified! Redirecting to your console...");

        // Strict role-based navigation with pending redirect check
        const pendingRedirect = typeof window !== "undefined" ? sessionStorage.getItem("claimspace_auth_redirect") : null;
        if (typeof window !== "undefined") sessionStorage.removeItem("claimspace_auth_redirect");

        if (pendingRedirect) {
          if (data.user.role === "admin" && pendingRedirect.startsWith("/admin")) {
            router.replace(pendingRedirect);
            return;
          }
          if (data.user.role === "user" && !pendingRedirect.startsWith("/admin")) {
            router.replace(pendingRedirect);
            return;
          }
        }

        if (data.user.role === "admin") {
          router.replace("/admin");
        } else {
          router.replace("/portal");
        }
      } catch (err: any) {
        console.error("Callback error:", err);
        setError(err.message || "Failed to complete authentication.");
      }
    };

    exchangeCode();
  }, [searchParams, setSession, router]);

  return (
    <div className="flex-1 flex items-center justify-center p-6">
      <div
        className="w-full max-w-md rounded-2xl border p-8 text-center space-y-6 shadow-sm"
        style={{
          backgroundColor: "var(--bg-card)",
          borderColor: "var(--border-default)",
        }}
      >
        {error ? (
          <div className="space-y-4">
            <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-red-100 dark:bg-red-950/40 text-red-600">
              <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <circle cx="12" cy="12" r="10" />
                <line x1="12" y1="8" x2="12" y2="12" />
                <line x1="12" y1="16" x2="12.01" y2="16" />
              </svg>
            </div>
            <h2 className="text-base font-semibold text-[var(--text-primary)]">Authentication Failed</h2>
            <p className="text-xs text-[var(--text-secondary)]">{error}</p>
            <button
              onClick={() => router.push("/login")}
              className="btn-squish rounded-xl px-4 py-2 text-xs font-semibold text-white"
              style={{ backgroundColor: "var(--accent)" }}
            >
              Return to Sign In
            </button>
          </div>
        ) : (
          <div className="space-y-4">
            <div className="mx-auto flex h-12 w-12 items-center justify-center">
              <span className="h-6 w-6 rounded-full border-2 border-[var(--accent)] border-t-transparent animate-spin" />
            </div>
            <h2 className="text-base font-semibold text-[var(--text-primary)]">ClaimSpace Authentication</h2>
            <p className="text-xs text-[var(--text-secondary)]">{status}</p>
          </div>
        )}
      </div>
    </div>
  );
}

export default function AuthCallbackPage() {
  return (
    <div className="min-h-screen flex flex-col selection:bg-[var(--accent)] selection:text-white">
      <Navbar />
      <Suspense fallback={<div className="flex-1 flex items-center justify-center">Loading authentication...</div>}>
        <CallbackContent />
      </Suspense>
    </div>
  );
}
