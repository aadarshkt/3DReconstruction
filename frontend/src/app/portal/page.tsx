"use client";

import React, { useState, useEffect, useCallback } from "react";
import { useRouter } from "next/navigation";
import Navbar from "@/components/Navbar";
import UploadSection from "@/components/UploadSection";
import PolicySection from "@/components/PolicySection";
import CostEstimateSection from "@/components/CostEstimateSection";
import ChatAssistantSection from "@/components/ChatAssistantSection";
import ExecutionHistoryDrawer from "@/components/ExecutionHistoryDrawer";
import { useAuth } from "@/context/AuthContext";

export default function UserPortalPage() {
  const { user, token, loading, isAdmin } = useAuth();
  const router = useRouter();

  const [activeTab, setActiveTab] = useState<"footage" | "policy" | "costs" | "assistant">("footage");
  const [jobId, setJobId] = useState<string | null>(null);
  const [claimId, setClaimId] = useState<string | null>(null);
  const [executionTitle, setExecutionTitle] = useState<string | null>(null);
  const [isRenaming, setIsRenaming] = useState(false);
  const [renameInput, setRenameInput] = useState("");
  const [jobData, setJobData] = useState<any | null>(null);
  const [isDemoMode, setIsDemoMode] = useState(false);
  const [isProcessing, setIsProcessing] = useState(false);
  const [policyDeductible, setPolicyDeductible] = useState<number>(1000);
  const [footageLoading, setFootageLoading] = useState(false);
  const [footageStatusMessage, setFootageStatusMessage] = useState("");
  const [policyLoading, setPolicyLoading] = useState(false);
  const [policyStatusMessage, setPolicyStatusMessage] = useState("");

  // Drawer state
  const [isHistoryDrawerOpen, setIsHistoryDrawerOpen] = useState(false);
  const [savedCount, setSavedCount] = useState<number>(0);

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

  // Refresh saved executions count
  const refreshSavedCount = useCallback(async () => {
    try {
      const res = await fetch("/api/v1/executions");
      if (res.ok) {
        const list = await res.json();
        setSavedCount(Array.isArray(list) ? list.length : 0);
      }
    } catch (_) {}
  }, []);

  useEffect(() => {
    refreshSavedCount();
  }, [refreshSavedCount]);

  // Load complete bundled execution by ID
  const loadExecution = useCallback(async (targetId: string) => {
    if (!targetId) return;
    setFootageLoading(true);
    setFootageStatusMessage("Restoring saved execution session...");

    try {
      const res = await fetch(`/api/v1/executions/${targetId}`);
      if (!res.ok) {
        throw new Error(`Execution not found (${res.status})`);
      }
      const data = await res.json();

      setClaimId(data.id);
      setExecutionTitle(data.title || "Damage Assessment");
      setIsDemoMode(false);

      if (data.job) {
        setJobId(data.job.id);

        let svgContent: string | undefined = undefined;
        if (data.job.files?.floor_plan_svg) {
          try {
            const svgRes = await fetch(data.job.files.floor_plan_svg);
            if (svgRes.ok) svgContent = await svgRes.text();
          } catch (_) {}
        }

        const parsedScan = {
          areaM2: data.job.room_area_m2 || 0,
          wallsCount: data.job.wall_count || (data.job.walls?.length ?? 0),
          errorEst: data.job.error_estimate?.expected_wall_error_cm
            ? `±${data.job.error_estimate.expected_wall_error_cm} cm`
            : "±1.5 cm",
          tier: data.job.tier || "photos",
          walls: data.job.walls || [],
          svgContent,
          plyUrl: data.job.files?.point_cloud_ply,
          damageAreaM2: data.job.damage_area_m2,
        };

        setJobData({
          job_id: data.job.id,
          ...data.job,
          ...parsedScan,
        });
      } else {
        setJobId(null);
        setJobData(null);
      }

      if (data.policy_analysis && data.policy_analysis.deductible != null) {
        setPolicyDeductible(data.policy_analysis.deductible);
      }

      if (typeof window !== "undefined") {
        localStorage.setItem("claimspace_active_execution_id", data.id);
        if (data.job_id) {
          localStorage.setItem("claimspace_active_job_id", data.job_id);
        }
        const url = new URL(window.location.href);
        url.searchParams.set("execution_id", data.id);
        if (data.job_id) url.searchParams.set("job_id", data.job_id);
        window.history.replaceState({}, "", url.toString());
      }

      setFootageStatusMessage("Execution restored.");
      refreshSavedCount();
    } catch (err: any) {
      console.error("Failed to load execution:", err);
      setFootageStatusMessage("Unable to load execution.");
    } finally {
      setFootageLoading(false);
    }
  }, [refreshSavedCount]);

  // Check query parameters and localStorage on mount
  useEffect(() => {
    if (typeof window !== "undefined") {
      const params = new URLSearchParams(window.location.search);
      const qTab = params.get("tab");
      if (qTab && ["footage", "policy", "costs", "assistant"].includes(qTab)) {
        setActiveTab(qTab as any);
      }

      const qExecId = params.get("execution_id") || params.get("claim_id");
      const savedExecId = localStorage.getItem("claimspace_active_execution_id");
      const activeExec = qExecId || savedExecId;

      if (activeExec) {
        loadExecution(activeExec);
      } else {
        const qJobId = params.get("job_id");
        const savedJobId = localStorage.getItem("claimspace_active_job_id");
        const activeJob = qJobId || savedJobId;
        if (activeJob && !jobId) {
          setJobId(activeJob);
        }
      }
    }
  }, [loadExecution]);

  const handleJobLoaded = (data: any, demoFlag = false) => {
    if (data.job_id) {
      setJobId(data.job_id);
      if (!demoFlag && !data.isDemo && !data.is_demo && typeof window !== "undefined") {
        localStorage.setItem("claimspace_active_job_id", data.job_id);
        const url = new URL(window.location.href);
        url.searchParams.set("job_id", data.job_id);
        window.history.replaceState({}, "", url.toString());
      }
    }
    const cid = data.claim_id || data.execution_id;
    if (cid) {
      setClaimId(cid);
      if (typeof window !== "undefined") {
        localStorage.setItem("claimspace_active_execution_id", cid);
        const url = new URL(window.location.href);
        url.searchParams.set("execution_id", cid);
        window.history.replaceState({}, "", url.toString());
      }
    }
    if (data.title) {
      setExecutionTitle(data.title);
    }
    setJobData(data);
    setIsDemoMode(demoFlag || Boolean(data.isDemo) || Boolean(data.is_demo));
    refreshSavedCount();
  };

  const handleStartNewRun = () => {
    setJobId(null);
    setClaimId(null);
    setExecutionTitle(null);
    setJobData(null);
    setIsDemoMode(false);
    setIsProcessing(false);
    setFootageStatusMessage("");
    setPolicyStatusMessage("");
    setIsRenaming(false);
    if (typeof window !== "undefined") {
      localStorage.removeItem("claimspace_active_job_id");
      localStorage.removeItem("claimspace_active_claim_id");
      localStorage.removeItem("claimspace_active_execution_id");
      const url = new URL(window.location.href);
      url.searchParams.delete("job_id");
      url.searchParams.delete("claim_id");
      url.searchParams.delete("execution_id");
      window.history.replaceState({}, "", url.toString());
    }
  };

  const handlePolicyAnalyzed = (analysis: any) => {
    if (analysis && analysis.deductible != null) {
      setPolicyDeductible(analysis.deductible);
    }
    refreshSavedCount();
  };

  const handleSaveRename = async () => {
    if (!claimId || !renameInput.trim()) return;
    try {
      const res = await fetch(`/api/v1/executions/${claimId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title: renameInput.trim() }),
      });
      if (res.ok) {
        setExecutionTitle(renameInput.trim());
        setIsRenaming(false);
        refreshSavedCount();
      }
    } catch (_) {}
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

      {/* Slide-over Drawer for Execution History */}
      <ExecutionHistoryDrawer
        isOpen={isHistoryDrawerOpen}
        onClose={() => setIsHistoryDrawerOpen(false)}
        activeExecutionId={claimId}
        onSelectExecution={(id) => loadExecution(id)}
        onStartNewRun={handleStartNewRun}
      />

      <main className="flex-1 py-6 sm:py-8 px-3 sm:px-6 lg:px-8">
        <div className="mx-auto max-w-6xl space-y-6 sm:space-y-8">
          {/* Welcome Header */}
          <div
            className="flex flex-col sm:flex-row sm:items-end justify-between gap-4 border-b pb-5 sm:pb-6"
            style={{ borderColor: "var(--border-subtle)" }}
          >
            <div className="space-y-1.5 flex-1">
              <div className="flex items-center gap-2 flex-wrap">
                <span className="text-[11px] font-mono uppercase tracking-widest text-[var(--accent)] font-semibold">
                  User Console
                </span>

                {/* Status Badges */}
                {isDemoMode ? (
                  <div className="inline-flex items-center gap-1.5 px-2 py-0.5 text-[11px] font-mono rounded border border-[var(--border-subtle)] text-[var(--text-muted)] bg-[var(--bg-surface)]">
                    <span>sample dataset</span>
                    <button
                      onClick={handleStartNewRun}
                      className="text-[10px] text-[var(--text-secondary)] hover:text-[var(--text-primary)] underline ml-1 cursor-pointer"
                    >
                      clear
                    </button>
                  </div>
                ) : claimId ? (
                  <div className="inline-flex items-center gap-1.5 px-2 py-0.5 text-[11px] font-mono rounded border border-[var(--accent-subtle)] text-[var(--accent)] bg-[var(--bg-surface)]">
                    <span>execution · {claimId.slice(0, 8)}</span>
                    <button
                      onClick={handleStartNewRun}
                      className="text-[10px] text-[var(--text-muted)] hover:text-[var(--text-primary)] underline ml-1 cursor-pointer"
                      title="Clear active run and start fresh capture"
                    >
                      clear
                    </button>
                  </div>
                ) : jobId ? (
                  <div className="inline-flex items-center gap-1.5 px-2 py-0.5 text-[11px] font-mono rounded border border-[var(--border-subtle)] text-[var(--text-secondary)] bg-[var(--bg-surface)]">
                    <span>scan · {jobId.slice(0, 8)}</span>
                    <button
                      onClick={handleStartNewRun}
                      className="text-[10px] text-[var(--text-muted)] hover:text-[var(--text-primary)] underline ml-1 cursor-pointer"
                    >
                      clear
                    </button>
                  </div>
                ) : (
                  <div className="inline-flex items-center gap-1.5 px-2 py-0.5 text-[11px] font-mono rounded border border-[var(--border-subtle)] text-[var(--text-muted)] bg-[var(--bg-surface)]">
                    <span>no active run</span>
                  </div>
                )}
              </div>

              {/* Title display or inline rename */}
              {isRenaming ? (
                <div className="flex items-center gap-2 max-w-lg pt-1">
                  <input
                    type="text"
                    value={renameInput}
                    onChange={(e) => setRenameInput(e.target.value)}
                    className="font-serif text-xl sm:text-2xl px-2 py-1 rounded border bg-[var(--bg-surface)] text-[var(--text-primary)] w-full focus:outline-none focus:ring-1 focus:ring-[var(--accent)]"
                    style={{ borderColor: "var(--border-default)" }}
                    autoFocus
                  />
                  <button
                    onClick={handleSaveRename}
                    className="text-xs font-mono px-3 py-1.5 rounded bg-[var(--accent)] text-white font-semibold whitespace-nowrap cursor-pointer"
                  >
                    Save
                  </button>
                  <button
                    onClick={() => setIsRenaming(false)}
                    className="text-xs font-mono px-3 py-1.5 rounded border border-[var(--border-subtle)] text-[var(--text-muted)] whitespace-nowrap cursor-pointer"
                  >
                    Cancel
                  </button>
                </div>
              ) : (
                <div className="flex items-baseline gap-2.5 flex-wrap">
                  <h1 className="font-serif text-2xl sm:text-3xl md:text-4xl font-medium tracking-tight text-[var(--text-primary)] leading-tight">
                    {executionTitle || "Claim & Reconstruction Overview"}
                  </h1>
                  {claimId && (
                    <button
                      onClick={() => {
                        setRenameInput(executionTitle || "Damage Assessment");
                        setIsRenaming(true);
                      }}
                      className="text-xs font-mono text-[var(--text-muted)] hover:text-[var(--text-primary)] underline cursor-pointer"
                    >
                      Rename
                    </button>
                  )}
                </div>
              )}

              <p className="text-xs text-[var(--text-secondary)]">
                Capture room dimensions, verify policy coverage, and calculate repair costs in minutes.
              </p>
            </div>

            {/* Header Actions: Saved Executions & Start New Run & PDF Report */}
            <div className="flex items-center gap-2 flex-wrap shrink-0">
              <button
                onClick={() => setIsHistoryDrawerOpen(true)}
                className="btn-squish px-3.5 py-2 text-xs font-mono rounded-lg border text-[var(--text-primary)] hover:bg-[var(--bg-surface)] transition-all cursor-pointer"
                style={{
                  backgroundColor: "var(--bg-card)",
                  borderColor: "var(--border-default)",
                }}
              >
                Saved Runs ({savedCount})
              </button>

              <button
                onClick={handleStartNewRun}
                className="btn-squish px-3.5 py-2 text-xs font-semibold rounded-lg text-white transition-all cursor-pointer whitespace-nowrap"
                style={{ backgroundColor: "var(--accent)" }}
              >
                Start New Run
              </button>

              {claimId && (
                <a
                  href={`/api/v1/executions/${claimId}/pdf`}
                  download
                  className="btn-squish px-3.5 py-2 text-xs font-mono rounded-lg border text-[var(--text-primary)] hover:bg-[var(--bg-surface)] transition-all cursor-pointer whitespace-nowrap"
                  style={{
                    backgroundColor: "var(--bg-surface)",
                    borderColor: "var(--border-default)",
                  }}
                >
                  Download Report PDF
                </a>
              )}
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
                claimId={claimId}
                onJobLoaded={handleJobLoaded}
                isLoading={footageLoading}
                setIsLoading={setFootageLoading}
                statusMessage={footageStatusMessage}
                setStatusMessage={setFootageStatusMessage}
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
                jobId={jobId}
                onPolicyAnalyzed={handlePolicyAnalyzed}
                isLoading={policyLoading}
                setIsLoading={setPolicyLoading}
                statusMessage={policyStatusMessage}
                setStatusMessage={setPolicyStatusMessage}
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
