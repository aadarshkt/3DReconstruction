"use client";

import React, { useState, Suspense } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import Navbar from "@/components/Navbar";
import { useAuth } from "@/context/AuthContext";

function LoginForm() {
  const { user, loginWithGoogle, loginDev, logout, isAdmin } = useAuth();
  const router = useRouter();
  const searchParams = useSearchParams();
  const redirectParam = searchParams.get("redirect");
  const [loadingRole, setLoadingRole] = useState<string | null>(null);
  const isDevMode = process.env.NODE_ENV !== "production" || process.env.NEXT_PUBLIC_ENABLE_DEV_LOGIN === "true";

  const handleDevLogin = async (role: "admin" | "user") => {
    setLoadingRole(role);
    try {
      await loginDev(role, undefined, undefined, redirectParam || undefined);
    } finally {
      setLoadingRole(null);
    }
  };

  const handleGoogleLogin = async () => {
    await loginWithGoogle(redirectParam || undefined);
  };

  return (
    <main className="flex-1 flex items-center justify-center px-4 sm:px-6 py-16">
      <div
        className="w-full max-w-md rounded-2xl border p-8 sm:p-10 space-y-8 shadow-sm transition-all"
        style={{
          backgroundColor: "var(--bg-card)",
          borderColor: "var(--border-default)",
          boxShadow: "var(--shadow-card)",
        }}
      >
        {/* Header */}
        <div className="text-center space-y-2">
          <span
            className="inline-flex h-10 w-10 items-center justify-center rounded-xl border font-serif text-lg font-semibold"
            style={{
              borderColor: "var(--border-default)",
              backgroundColor: "var(--bg-surface)",
              color: "var(--accent)",
            }}
          >
            C
          </span>
          <h1 className="font-serif text-2xl sm:text-3xl font-medium tracking-tight text-[var(--text-primary)]">
            Welcome to ClaimSpace
          </h1>
          <p className="text-xs text-[var(--text-secondary)]">
            Sign in with Google OAuth to access property scans, claims, and spatial digital twins.
          </p>
        </div>

        {/* Informative redirect alert */}
        {redirectParam && (
          <div
            className="rounded-xl border px-3.5 py-2.5 text-center text-xs font-mono"
            style={{
              backgroundColor: "color-mix(in srgb, var(--accent) 8%, var(--bg-surface))",
              borderColor: "color-mix(in srgb, var(--accent) 30%, transparent)",
              color: "var(--accent)",
            }}
          >
            🔒 Sign in required to enter {redirectParam.startsWith("/portal") ? "your User Console" : "this workspace"}.
          </div>
        )}

        {/* If already logged in */}
        {user ? (
          <div
            className="rounded-xl border p-5 text-center space-y-4"
            style={{
              backgroundColor: "var(--bg-surface)",
              borderColor: "var(--border-default)",
            }}
          >
            <div className="space-y-1">
              <span className="text-[10px] uppercase tracking-widest font-mono text-[var(--text-muted)]">
                Currently Signed In
              </span>
              <p className="text-sm font-semibold text-[var(--text-primary)]">{user.email}</p>
              <span
                className={`inline-flex items-center px-2 py-0.5 rounded text-[10px] font-mono uppercase font-semibold border ${
                  isAdmin
                    ? "bg-amber-500/10 text-amber-600 dark:text-amber-400 border-amber-500/30"
                    : "bg-blue-500/10 text-blue-600 dark:text-blue-400 border-blue-500/30"
                }`}
              >
                Role: {user.role}
              </span>
            </div>

            <div className="flex flex-col gap-2 pt-2">
              <button
                onClick={() => {
                  if (redirectParam) {
                    if (isAdmin && redirectParam.startsWith("/admin")) {
                      router.push(redirectParam);
                      return;
                    }
                    if (!isAdmin && !redirectParam.startsWith("/admin")) {
                      router.push(redirectParam);
                      return;
                    }
                  }
                  router.push(isAdmin ? "/admin" : "/portal");
                }}
                className="btn-squish w-full rounded-xl py-2.5 text-xs font-semibold text-white shadow-sm transition-all"
                style={{ backgroundColor: "var(--accent)" }}
              >
                Proceed to {isAdmin ? "Admin Console" : "User Console"} →
              </button>

              <button
                onClick={logout}
                className="btn-squish w-full rounded-xl py-2 text-xs font-medium border text-[var(--text-secondary)] hover:text-red-500 transition-colors"
                style={{ borderColor: "var(--border-default)" }}
              >
                Sign Out of Current Account
              </button>
            </div>
          </div>
        ) : (
          <>
            {/* Official Google OAuth Sign-in Button */}
            <div className="space-y-3">
              <button
                onClick={handleGoogleLogin}
                className="btn-squish w-full flex items-center justify-center gap-3 rounded-xl border py-2.5 px-4 text-xs font-medium text-[var(--text-primary)] shadow-sm hover:border-[var(--border-strong)] transition-all"
                style={{
                  backgroundColor: "var(--bg-surface)",
                  borderColor: "var(--border-default)",
                }}
              >
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none">
                  <path
                    d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"
                    fill="#4285F4"
                  />
                  <path
                    d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
                    fill="#34A853"
                  />
                  <path
                    d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.06H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.94l2.85-2.22.81-.63z"
                    fill="#FBBC05"
                  />
                  <path
                    d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.06l3.66 2.84c.87-2.6 3.3-4.52 6.16-4.52z"
                    fill="#EA4335"
                  />
                </svg>
                <span>Continue with Google OAuth</span>
              </button>
            </div>

            {/* Divider & Dev Role Test Buttons: Only visible in local development, automatically hidden in production */}
            {isDevMode && (
              <>
                <div className="relative flex items-center justify-center">
                  <div className="w-full border-t" style={{ borderColor: "var(--border-subtle)" }} />
                  <span
                    className="absolute px-3 text-[10px] uppercase tracking-widest font-mono text-[var(--text-muted)]"
                    style={{ backgroundColor: "var(--bg-card)" }}
                  >
                    Local Dev Instant Testing
                  </span>
                </div>

                <div className="space-y-3">
                  <div className="p-3.5 rounded-xl border space-y-2" style={{ backgroundColor: "var(--bg-surface)", borderColor: "var(--border-subtle)" }}>
                    <div className="flex items-center justify-between">
                      <span className="text-xs font-semibold text-[var(--text-primary)]">Admin Workstation</span>
                      <span className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-amber-500/10 text-amber-600 dark:text-amber-400 border border-amber-500/30">
                        DEV ADMIN
                      </span>
                    </div>
                    <p className="text-[11px] text-[var(--text-secondary)]">
                      Test pipeline diagnostics, closed-loop telemetry, worker queues, and seed tests.
                    </p>
                    <button
                      onClick={() => handleDevLogin("admin")}
                      disabled={loadingRole !== null}
                      className="btn-squish w-full mt-1 flex items-center justify-center gap-2 rounded-lg py-2 text-xs font-semibold text-white shadow-sm transition-all"
                      style={{ backgroundColor: "var(--accent)" }}
                    >
                      {loadingRole === "admin" ? (
                        <span className="h-4 w-4 rounded-full border-2 border-white border-t-transparent animate-spin" />
                      ) : (
                        "Sign In as Admin (Dev) →"
                      )}
                    </button>
                  </div>

                  <div className="p-3.5 rounded-xl border space-y-2" style={{ backgroundColor: "var(--bg-surface)", borderColor: "var(--border-subtle)" }}>
                    <div className="flex items-center justify-between">
                      <span className="text-xs font-semibold text-[var(--text-primary)]">User Portal</span>
                      <span className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-blue-500/10 text-blue-600 dark:text-blue-400 border border-blue-500/30">
                        DEV USER
                      </span>
                    </div>
                    <p className="text-[11px] text-[var(--text-secondary)]">
                      Test 3D floor plan viewer, property scans, claims list, and repair estimates.
                    </p>
                    <button
                      onClick={() => handleDevLogin("user")}
                      disabled={loadingRole !== null}
                      className="btn-squish w-full mt-1 flex items-center justify-center gap-2 rounded-lg py-2 text-xs font-semibold border border-[var(--border-default)] hover:border-[var(--border-strong)] text-[var(--text-primary)] shadow-sm transition-all"
                      style={{ backgroundColor: "var(--bg-card)" }}
                    >
                      {loadingRole === "user" ? (
                        <span className="h-4 w-4 rounded-full border-2 border-[var(--accent)] border-t-transparent animate-spin" />
                      ) : (
                        "Sign In as Policyholder (Dev) →"
                      )}
                    </button>
                  </div>
                </div>
              </>
            )}
          </>
        )}

        {/* Footer Terms */}
        <p className="text-center text-[11px] leading-relaxed text-[var(--text-muted)]">
          By proceeding, you agree to our{" "}
          <span className="underline underline-offset-2">Terms of Service</span> and{" "}
          <span className="underline underline-offset-2">Privacy Policy</span>.
        </p>
      </div>
    </main>
  );
}

export default function LoginPage() {
  return (
    <div className="min-h-screen flex flex-col selection:bg-[var(--accent)] selection:text-white">
      <Navbar />
      <Suspense
        fallback={
          <div className="flex-1 flex items-center justify-center p-8">
            <span className="h-7 w-7 rounded-full border-2 border-[var(--accent)] border-t-transparent animate-spin" />
          </div>
        }
      >
        <LoginForm />
      </Suspense>
    </div>
  );
}
