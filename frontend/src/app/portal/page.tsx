"use client";

import React, { useState, useEffect } from "react";
import Navbar from "@/components/Navbar";
import WalkthroughModal from "@/components/WalkthroughModal";
import UploadSection from "@/components/UploadSection";
import PolicySection from "@/components/PolicySection";
import CostEstimateSection from "@/components/CostEstimateSection";
import ChatAssistantSection from "@/components/ChatAssistantSection";

export default function UserPortalPage() {
  const [activeTab, setActiveTab] = useState<"footage" | "policy" | "costs" | "assistant">("footage");
  const [isTourOpen, setIsTourOpen] = useState(false);
  const [jobId, setJobId] = useState<string | null>(null);
  const [claimId, setClaimId] = useState<string | null>(null);
  const [jobData, setJobData] = useState<any | null>(null);
  const [isDemoMode, setIsDemoMode] = useState(false);
  const [isProcessing, setIsProcessing] = useState(false);
  const [policyDeductible, setPolicyDeductible] = useState<number>(1000);
  const [isLoading, setIsLoading] = useState(false);
  const [statusMessage, setStatusMessage] = useState("");

  // Check query parameters (e.g. ?tour=true or ?tab=...)
  useEffect(() => {
    if (typeof window !== "undefined") {
      const params = new URLSearchParams(window.location.search);
      if (params.get("tour") === "true") {
        setIsTourOpen(true);
      }
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

  const handleLoadSample = async () => {
    setIsLoading(true);
    setStatusMessage("Loading verified sample 3D scan and policy...");
    try {
      const res = await fetch("/claims/seed-demo", { method: "POST" });
      if (!res.ok) throw new Error(await res.text());
      const data = await res.json();
      handleJobLoaded(data, true);
      setStatusMessage("Sample claim and 3D scan loaded.");
    } catch (_) {
      handleJobLoaded({ job_id: "demo-job", areaM2: 24.5, wallsCount: 4 }, true);
      setStatusMessage("Sample dataset loaded.");
    } finally {
      setIsLoading(false);
    }
  };

  const handlePolicyAnalyzed = (analysis: any) => {
    if (analysis && analysis.deductible != null) {
      setPolicyDeductible(analysis.deductible);
    }
  };

  return (
    <div className="min-h-screen flex flex-col selection:bg-[var(--accent)] selection:text-white">
      <Navbar onStartTour={() => setIsTourOpen(true)} />

      {/* Guided Walkthrough Modal */}
      <WalkthroughModal
        isOpen={isTourOpen}
        onClose={() => setIsTourOpen(false)}
        onNavigateTab={(tabKey) => {
          if (["footage", "policy", "costs", "assistant"].includes(tabKey)) {
            setActiveTab(tabKey as any);
          }
        }}
      />

      <main className="flex-1 py-8 px-4 sm:px-6 lg:px-8">
        <div className="mx-auto max-w-6xl space-y-8">
          {/* Welcome Header */}
          <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-4 border-b pb-6" style={{ borderColor: "var(--border-subtle)" }}>
            <div className="space-y-1">
              <div className="flex items-center gap-2">
                <span className="text-[11px] font-mono uppercase tracking-widest text-[var(--accent)] font-semibold">
                  User Workspace
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

              <h1 className="font-serif text-3xl sm:text-4xl font-medium tracking-tight text-[var(--text-primary)]">
                Claim & Reconstruction Overview
              </h1>
              <p className="text-xs text-[var(--text-secondary)]">
                Capture room dimensions, verify policy coverage, and calculate repair costs in minutes.
              </p>
            </div>

            <div className="flex items-center gap-2">
              {!isDemoMode && !jobId && (
                <button
                  onClick={handleLoadSample}
                  disabled={isLoading}
                  className="btn-squish inline-flex items-center gap-1.5 rounded-lg border px-3 py-2 text-xs font-medium text-[var(--text-primary)] shadow-sm hover:border-[var(--border-strong)] transition-all"
                  style={{
                    backgroundColor: "var(--bg-surface)",
                    borderColor: "var(--border-default)",
                  }}
                >
                  Load Sample Dataset
                </button>
              )}

              <button
                onClick={() => setIsTourOpen(true)}
                className="btn-squish inline-flex items-center gap-1.5 rounded-lg border px-3.5 py-2 text-xs font-medium text-[var(--text-primary)] shadow-sm hover:border-[var(--border-strong)] transition-all"
                style={{
                  backgroundColor: "var(--bg-card)",
                  borderColor: "var(--border-default)",
                }}
              >
                <span className="h-1.5 w-1.5 rounded-full bg-[var(--accent)] animate-pulse" />
                Second-Person Walkthrough
              </button>
            </div>
          </div>

          {/* Workflow Tabs */}
          <div
            className="flex items-center gap-2 p-1.5 rounded-xl border overflow-x-auto no-scrollbar"
            style={{
              backgroundColor: "var(--bg-surface)",
              borderColor: "var(--border-subtle)",
            }}
          >
            {[
              { key: "footage", label: "1. Property Footage (Images/Videos/LiDAR)" },
              { key: "policy", label: "2. Insurance Policy Documents" },
              { key: "costs", label: "3. Cost Calculation & Repair Schedule" },
              { key: "assistant", label: "4. Claim Assistant & General QA" },
            ].map((tab) => (
              <button
                key={tab.key}
                onClick={() => setActiveTab(tab.key as any)}
                className={`btn-squish shrink-0 px-4 py-2 text-xs font-medium rounded-lg transition-all ${
                  activeTab === tab.key
                    ? "bg-[var(--bg-card)] text-[var(--text-primary)] font-semibold shadow-sm border"
                    : "text-[var(--text-secondary)] hover:text-[var(--text-primary)]"
                }`}
                style={{
                  borderColor: activeTab === tab.key ? "var(--border-default)" : "transparent",
                }}
              >
                {tab.label}
              </button>
            ))}
          </div>

          {/* Active Workspace View */}
          <div
            className="rounded-2xl border p-6 sm:p-8 transition-all"
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
