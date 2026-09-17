"use client";

import React, { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import Navbar from "@/components/Navbar";
import UploadSection from "@/components/UploadSection";
import PolicySection from "@/components/PolicySection";
import CostEstimateSection from "@/components/CostEstimateSection";
import ChatAssistantSection from "@/components/ChatAssistantSection";
import { useAuth } from "@/context/AuthContext";

export default function UserPortalPage() {
  const { user, token, loading, isAdmin } = useAuth();
  const router = useRouter();

  const [activeTab, setActiveTab] = useState<"footage" | "policy" | "costs" | "assistant">("footage");
  const [jobId, setJobId] = useState<string | null>(null);
  const [claimId, setClaimId] = useState<string | null>(null);
  const [jobData, setJobData] = useState<any | null>(null);
  const [isDemoMode, setIsDemoMode] = useState(false);
  const [isProcessing, setIsProcessing] = useState(false);
  const [policyDeductible, setPolicyDeductible] = useState<number>(1000);
  const [isLoading, setIsLoading] = useState(false);
  const [statusMessage, setStatusMessage] = useState("");

  // Client-side authentication guard
  useEffect(() => {
    if (!loading) {
      if (!user && !token) {
        router.replace("/login?redirect=/portal");
      } else if (isAdmin) {
        router.replace("/admin");
      }
    }
  }, [loading, user, token, isAdmin, router]);

  // Check query parameters (e.g. ?tab=...)
  useEffect(() => {
    if (typeof window !== "undefined") {
      const params = new URLSearchParams(window.location.search);
      const qTab = params.get("tab");
      if (qTab && ["footage", "policy", "costs", "assistant"].includes(qTab)) {
        setActiveTab(qTab as any);
      }
    }
  }, []);

  const handleJobLoaded = (data: any, demoFlag = false) => {
    if (data.job_id) setJobId(data.job_id);
    if (data.claim_id) setClaimId(data.claim_id);
    setJobData(data);
    setIsDemoMode(demoFlag || Boolean(data.isDemo) || Boolean(data.is_demo));
  };

  const handleClearData = () => {
    setJobId(null);
    setClaimId(null);
    setJobData(null);
    setIsDemoMode(false);
    setIsProcessing(false);
    setStatusMessage("");
  };

  const handlePolicyAnalyzed = (analysis: any) => {
    if (analysis && analysis.deductible != null) {
      setPolicyDeductible(analysis.deductible);
    }
  };

  if (loading || (!user && !token) || isAdmin) {
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

  return (
    <div className="min-h-screen flex flex-col selection:bg-[var(--accent)] selection:text-white">
      <Navbar />

      <main className="flex-1 py-6 sm:py-8 px-3 sm:px-6 lg:px-8">
        <div className="mx-auto max-w-6xl space-y-6 sm:space-y-8">
          {/* Welcome Header */}
          <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-4 border-b pb-5 sm:pb-6" style={{ borderColor: "var(--border-subtle)" }}>
            <div className="space-y-1.5">
              <div className="flex items-center gap-2 flex-wrap">
                <span className="text-[11px] font-mono uppercase tracking-widest text-[var(--accent)] font-semibold">
                  User Console
                </span>
                {/* Minimalist status badge */}
                {isDemoMode ? (
                  <div className="inline-flex items-center gap-1.5 px-2 py-0.5 text-[11px] font-mono rounded border border-[var(--border-subtle)] text-[var(--text-muted)] bg-[var(--bg-surface)]">
                    <span>sample dataset</span>
                    <button
                      onClick={handleClearData}
                      className="text-[10px] text-[var(--text-secondary)] hover:text-[var(--text-primary)] underline ml-1"
                    >
                      clear
                    </button>
                  </div>
                ) : jobId ? (
                  <div className="inline-flex items-center gap-1.5 px-2 py-0.5 text-[11px] font-mono rounded border border-[var(--accent-subtle)] text-[var(--accent)] bg-[var(--bg-surface)]">
                    <span>live project · {jobId.slice(0, 8)}</span>
                  </div>
                ) : (
                  <div className="inline-flex items-center gap-1.5 px-2 py-0.5 text-[11px] font-mono rounded border border-[var(--border-subtle)] text-[var(--text-muted)] bg-[var(--bg-surface)]">
                    <span>no active scan</span>
                  </div>
                )}
              </div>

              <h1 className="font-serif text-2xl sm:text-3xl md:text-4xl font-medium tracking-tight text-[var(--text-primary)] leading-tight">
                Claim & Reconstruction Overview
              </h1>
              <p className="text-xs text-[var(--text-secondary)]">
                Capture room dimensions, verify policy coverage, and calculate repair costs in minutes.
              </p>
            </div>
          </div>

          {/* Responsive Workflow Tabs */}
          <div
            className="flex items-center gap-1.5 sm:gap-2 p-1 sm:p-1.5 rounded-xl border overflow-x-auto no-scrollbar"
            style={{
              backgroundColor: "var(--bg-surface)",
              borderColor: "var(--border-subtle)",
            }}
          >
            {[
              { key: "footage", label: "1. Property Footage (Images/Videos/LiDAR)", shortLabel: "1. Footage" },
              { key: "policy", label: "2. Insurance Policy Documents", shortLabel: "2. Policy" },
              { key: "costs", label: "3. Cost Calculation & Repair Schedule", shortLabel: "3. Costs" },
              { key: "assistant", label: "4. Claim Assistant & General QA", shortLabel: "4. Assistant" },
            ].map((tab) => (
              <button
                key={tab.key}
                onClick={() => setActiveTab(tab.key as any)}
                className={`btn-squish shrink-0 px-2.5 sm:px-4 py-2 text-xs font-medium rounded-lg transition-all ${
                  activeTab === tab.key
                    ? "bg-[var(--bg-card)] text-[var(--text-primary)] font-semibold shadow-sm border"
                    : "text-[var(--text-secondary)] hover:text-[var(--text-primary)]"
                }`}
                style={{
                  borderColor: activeTab === tab.key ? "var(--border-default)" : "transparent",
                }}
              >
                <span className="hidden md:inline">{tab.label}</span>
                <span className="md:hidden">{tab.shortLabel}</span>
              </button>
            ))}
          </div>

          {/* Active Workspace View */}
          <div
            className="rounded-2xl border p-4 sm:p-6 lg:p-8 transition-all"
            style={{
              backgroundColor: "var(--bg-card)",
              borderColor: "var(--border-default)",
              boxShadow: "var(--shadow-card)",
            }}
          >
            {activeTab === "footage" && (
              <UploadSection
                jobId={jobId}
                onJobLoaded={handleJobLoaded}
                isLoading={isLoading}
                setIsLoading={setIsLoading}
                statusMessage={statusMessage}
                setStatusMessage={setStatusMessage}
                isProcessing={isProcessing}
                setIsProcessing={setIsProcessing}
                isDemo={isDemoMode}
                jobData={jobData}
                onNavigateTab={(tab) => setActiveTab(tab)}
              />
            )}

            {activeTab === "policy" && (
              <PolicySection
                claimId={claimId}
                onPolicyAnalyzed={handlePolicyAnalyzed}
                isLoading={isLoading}
                setIsLoading={setIsLoading}
                statusMessage={statusMessage}
                setStatusMessage={setStatusMessage}
                isDemo={isDemoMode}
              />
            )}

            {activeTab === "costs" && (
              <CostEstimateSection
                claimId={claimId}
                policyDeductible={policyDeductible}
                jobData={jobData}
                isProcessing={isProcessing}
                isDemo={isDemoMode}
                onNavigateTab={(tab) => setActiveTab(tab)}
              />
            )}

            {activeTab === "assistant" && (
              <ChatAssistantSection claimId={claimId} />
            )}
          </div>
        </div>
      </main>
    </div>
  );
}
