"use client";

import React, { useState } from "react";
import Link from "next/link";
import Navbar from "@/components/Navbar";

export default function LoginPage() {
  const [email, setEmail] = useState("");
  const [submitted, setSubmitted] = useState(false);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!email.trim()) return;
    setSubmitted(true);
  };

  return (
    <div className="min-h-screen flex flex-col selection:bg-[var(--accent)] selection:text-white">
      <Navbar />

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
              Sign in to manage your spatial 3D property scans and insurance claims.
            </p>
          </div>

          {/* Social Sign In Button */}
          <div className="space-y-3">
            <button
              onClick={() => (window.location.href = "/portal")}
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
              <span>Continue with Google</span>
            </button>
          </div>

          <div className="relative flex items-center justify-center">
            <div className="w-full border-t" style={{ borderColor: "var(--border-subtle)" }} />
            <span
              className="absolute px-3 text-[10px] uppercase tracking-widest font-mono text-[var(--text-muted)]"
              style={{ backgroundColor: "var(--bg-card)" }}
            >
              Or with Email
            </span>
          </div>

          {/* Form */}
          {submitted ? (
            <div
              className="rounded-xl border p-4 text-center space-y-2"
              style={{
                backgroundColor: "var(--bg-surface)",
                borderColor: "var(--accent)",
              }}
            >
              <span className="text-xs font-semibold text-[var(--accent)]">
                Magic Link Sent
              </span>
              <p className="text-xs text-[var(--text-secondary)]">
                We have sent an authentication link to <strong>{email}</strong>.
              </p>
              <div className="pt-2">
                <Link
                  href="/portal"
                  className="btn-squish inline-flex items-center text-xs font-semibold text-[var(--accent)] underline underline-offset-2"
                >
                  Proceed to Portal Demo →
                </Link>
              </div>
            </div>
          ) : (
            <form onSubmit={handleSubmit} className="space-y-4">
              <div className="space-y-1.5">
                <label className="block text-xs font-medium text-[var(--text-secondary)]">
                  Email Address
                </label>
                <input
                  type="email"
                  required
                  placeholder="name@example.com"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  className="w-full rounded-xl border px-3.5 py-2.5 text-xs text-[var(--text-primary)] placeholder-[var(--text-muted)] focus:outline-none focus:ring-1 focus:ring-[var(--accent)]"
                  style={{
                    backgroundColor: "var(--bg-surface)",
                    borderColor: "var(--border-default)",
                  }}
                />
              </div>

              <button
                type="submit"
                className="btn-squish w-full rounded-xl py-2.5 text-xs font-semibold text-white shadow-sm transition-all"
                style={{
                  backgroundColor: "var(--accent)",
                }}
              >
                Send Magic Link
              </button>
            </form>
          )}

          {/* Footer Terms */}
          <p className="text-center text-[11px] leading-relaxed text-[var(--text-muted)]">
            By proceeding, you agree to our{" "}
            <span className="underline underline-offset-2">Terms of Service</span> and{" "}
            <span className="underline underline-offset-2">Privacy Policy</span>.
          </p>
        </div>
      </main>
    </div>
  );
}
