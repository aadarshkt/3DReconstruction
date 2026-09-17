"use client";

import React, { useEffect } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import Navbar from "@/components/Navbar";
import { useAuth } from "@/context/AuthContext";

export default function ProfilePage() {
  const { user: authUser, token, loading } = useAuth();
  const router = useRouter();

  useEffect(() => {
    if (!loading && !authUser && !token) {
      router.replace("/login?redirect=/profile");
    }
  }, [loading, authUser, token, router]);

  if (loading || (!authUser && !token)) {
    return (
      <div className="min-h-screen flex flex-col selection:bg-[var(--accent)] selection:text-white">
        <Navbar />
        <div className="flex-1 flex items-center justify-center p-8">
          <div className="flex flex-col items-center gap-3">
            <span className="h-7 w-7 rounded-full border-2 border-[var(--accent)] border-t-transparent animate-spin" />
            <p className="text-xs font-mono text-[var(--text-muted)]">Verifying session...</p>
          </div>
        </div>
      </div>
    );
  }

  const user = {
    name: authUser?.full_name || authUser?.email?.split("@")[0] || "Aadarsh K.",
    email: authUser?.email || "aadarsh@example.com",
    policyNumber: "HO3-8472910-CA",
    insurer: "State Farm Fire & Casualty",
    propertyAddress: "742 Evergreen Terrace, Springfield, OR",
    accountTier: "Enterprise Spatial Pro",
  };

  const claimsHistory = [
    {
      id: "CLM-2026-081",
      date: "2026-09-14",
      cause: "Plumbing Pipe Burst (Water)",
      status: "Verified / Estimate Ready",
      scanArea: "24.5 m² (4 Walls)",
      grossTotal: "$5,548.80",
      netPayout: "$5,103.68",
    },
    {
      id: "CLM-2026-042",
      date: "2026-06-22",
      cause: "Windstorm Shingle Tear-off",
      status: "Settled",
      scanArea: "48.2 m² Roof Surface",
      grossTotal: "$3,820.00",
      netPayout: "$2,820.00",
    },
  ];

  return (
    <div className="min-h-screen flex flex-col selection:bg-[var(--accent)] selection:text-white">
      <Navbar />

      <main className="flex-1 py-10 px-4 sm:px-6 lg:px-8">
        <div className="mx-auto max-w-5xl space-y-8">
          {/* Top Title */}
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b pb-6" style={{ borderColor: "var(--border-subtle)" }}>
            <div>
              <span className="text-[11px] font-mono uppercase tracking-widest text-[var(--accent)] font-semibold">
                Account & Policyholder Profile
              </span>
              <h1 className="font-serif text-3xl font-medium tracking-tight text-[var(--text-primary)] mt-1">
                {user.name}
              </h1>
              <p className="text-xs text-[var(--text-secondary)]">
                {user.propertyAddress}
              </p>
            </div>

            <Link
              href="/portal"
              className="btn-squish w-full sm:w-auto inline-flex items-center justify-center rounded-xl px-4 py-2.5 text-xs font-semibold text-white shadow-sm transition-all text-center"
              style={{
                backgroundColor: "var(--accent)",
              }}
            >
              Start New Claim & Scan
            </Link>
          </div>

          {/* Profile Cards */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            {/* Policy Info Card */}
            <div
              className="rounded-2xl border p-6 space-y-4"
              style={{
                backgroundColor: "var(--bg-card)",
                borderColor: "var(--border-default)",
              }}
            >
              <div className="font-serif text-lg font-medium text-[var(--text-primary)]">
                Active Insurance Policy
              </div>
              <div className="space-y-2.5 text-xs">
                <div>
                  <div className="text-[10px] font-mono uppercase text-[var(--text-muted)]">Insurer</div>
                  <div className="font-medium text-[var(--text-primary)]">{user.insurer}</div>
                </div>
                <div>
                  <div className="text-[10px] font-mono uppercase text-[var(--text-muted)]">Policy Number</div>
                  <div className="font-mono text-[var(--text-primary)]">{user.policyNumber}</div>
                </div>
                <div>
                  <div className="text-[10px] font-mono uppercase text-[var(--text-muted)]">Coverage Form</div>
                  <div className="text-[var(--text-primary)]">ISO HO-3 Comprehensive</div>
                </div>
                <div>
                  <div className="text-[10px] font-mono uppercase text-[var(--text-muted)]">Standard Deductible</div>
                  <div className="text-[var(--text-primary)]">$1,000.00</div>
                </div>
              </div>
            </div>

            {/* Account Tier Card */}
            <div
              className="rounded-2xl border p-6 space-y-4"
              style={{
                backgroundColor: "var(--bg-card)",
                borderColor: "var(--border-default)",
              }}
            >
              <div className="font-serif text-lg font-medium text-[var(--text-primary)]">
                Spatial License Tier
              </div>
              <div className="space-y-2.5 text-xs">
                <div>
                  <div className="text-[10px] font-mono uppercase text-[var(--text-muted)]">Current Plan</div>
                  <div className="font-medium text-[var(--accent)]">{user.accountTier}</div>
                </div>
                <div>
                  <div className="text-[10px] font-mono uppercase text-[var(--text-muted)]">Reconstruction Quota</div>
                  <div className="text-[var(--text-primary)]">Unlimited 3D Scans & Floor Plans</div>
                </div>
                <div>
                  <div className="text-[10px] font-mono uppercase text-[var(--text-muted)]">RAG Vector Storage</div>
                  <div className="text-[var(--text-primary)]">ChromaDB Dedicated Index</div>
                </div>
              </div>
            </div>

            {/* Quick Actions */}
            <div
              className="rounded-2xl border p-6 space-y-4"
              style={{
                backgroundColor: "var(--bg-card)",
                borderColor: "var(--border-default)",
              }}
            >
              <div className="font-serif text-lg font-medium text-[var(--text-primary)]">
                Quick Shortcuts
              </div>
              <div className="flex flex-col gap-2 pt-1">
                <Link
                  href="/portal?tab=footage"
                  className="btn-squish rounded-lg border p-2.5 text-xs text-[var(--text-primary)] hover:bg-[var(--bg-surface)] transition-colors"
                  style={{ borderColor: "var(--border-subtle)" }}
                >
                  Upload New 3D Scan →
                </Link>
                <Link
                  href="/portal?tab=policy"
                  className="btn-squish rounded-lg border p-2.5 text-xs text-[var(--text-primary)] hover:bg-[var(--bg-surface)] transition-colors"
                  style={{ borderColor: "var(--border-subtle)" }}
                >
                  Review Policy Endorsements →
                </Link>
                <Link
                  href="/admin"
                  className="btn-squish rounded-lg border p-2.5 text-xs text-[var(--text-primary)] hover:bg-[var(--bg-surface)] transition-colors"
                  style={{ borderColor: "var(--border-subtle)" }}
                >
                  System Diagnostics & Pipeline Logs →
                </Link>
              </div>
            </div>
          </div>

          {/* Claims History Section */}
          <div
            className="rounded-2xl border overflow-hidden"
            style={{
              backgroundColor: "var(--bg-card)",
              borderColor: "var(--border-default)",
            }}
          >
            <div className="px-4 sm:px-6 py-3.5 sm:py-4 border-b flex items-center justify-between" style={{ borderColor: "var(--border-subtle)" }}>
              <span className="font-serif text-base font-semibold text-[var(--text-primary)]">
                Recent Claims & Spatial Surveys
              </span>
              <span className="text-[11px] font-mono text-[var(--text-muted)]">
                Total Claims: {claimsHistory.length}
              </span>
            </div>

            {/* Mobile Claims Cards (< md) */}
            <div className="md:hidden divide-y" style={{ borderColor: "var(--border-subtle)" }}>
              {claimsHistory.map((clm) => (
                <div key={clm.id} className="p-4 space-y-2">
                  <div className="flex items-center justify-between">
                    <span className="font-mono text-xs font-semibold text-[var(--accent)]">{clm.id}</span>
                    <span className="inline-flex items-center px-2 py-0.5 rounded text-[10px] font-medium bg-emerald-500/10 text-emerald-700 dark:text-emerald-400 border border-emerald-500/20">
                      {clm.status}
                    </span>
                  </div>
                  <div className="text-xs font-medium text-[var(--text-primary)]">{clm.cause}</div>
                  <div className="flex items-center justify-between text-[11px] text-[var(--text-secondary)] font-mono pt-1">
                    <span>{clm.date} · {clm.scanArea}</span>
                    <span className="font-semibold text-[var(--text-primary)] text-xs">{clm.netPayout}</span>
                  </div>
                </div>
              ))}
            </div>

            {/* Desktop Claims Table (md and above) */}
            <div className="hidden md:block overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead>
                  <tr
                    className="border-b text-[10px] font-mono uppercase tracking-wider text-[var(--text-muted)]"
                    style={{
                      backgroundColor: "var(--bg-surface)",
                      borderColor: "var(--border-subtle)",
                    }}
                  >
                    <th className="py-3 px-6">Claim ID</th>
                    <th className="py-3 px-4">Date</th>
                    <th className="py-3 px-6">Peril / Cause</th>
                    <th className="py-3 px-4">3D Area</th>
                    <th className="py-3 px-4">Status</th>
                    <th className="py-3 px-6 text-right">Net Payout</th>
                  </tr>
                </thead>
                <tbody className="divide-y" style={{ borderColor: "var(--border-subtle)" }}>
                  {claimsHistory.map((clm) => (
                    <tr key={clm.id} className="hover:bg-[var(--bg-surface)] transition-colors">
                      <td className="py-3.5 px-6 font-mono font-medium text-[var(--accent)]">
                        {clm.id}
                      </td>
                      <td className="py-3.5 px-4 text-[var(--text-secondary)] font-mono">
                        {clm.date}
                      </td>
                      <td className="py-3.5 px-6 text-[var(--text-primary)] font-medium">
                        {clm.cause}
                      </td>
                      <td className="py-3.5 px-4 font-mono text-[var(--text-secondary)]">
                        {clm.scanArea}
                      </td>
                      <td className="py-3.5 px-4">
                        <span className="inline-flex items-center px-2 py-0.5 rounded text-[10px] font-medium bg-emerald-500/10 text-emerald-700 dark:text-emerald-400 border border-emerald-500/20">
                          {clm.status}
                        </span>
                      </td>
                      <td className="py-3.5 px-6 text-right font-mono font-semibold text-[var(--text-primary)]">
                        {clm.netPayout}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      </main>
    </div>
  );
}
