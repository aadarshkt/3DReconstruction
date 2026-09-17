"use client";

import React, { useState, useEffect, useRef } from "react";
import Navbar from "@/components/Navbar";
import UploadSection from "@/components/UploadSection";
import PolicySection from "@/components/PolicySection";
import CostEstimateSection from "@/components/CostEstimateSection";
import ChatAssistantSection from "@/components/ChatAssistantSection";
import { driver } from "driver.js";

export default function GuidedTourPage() {
  const [activeTab, setActiveTab] = useState<"footage" | "policy" | "costs" | "assistant">("footage");
  const [jobId, setJobId] = useState<string | null>("tour-demo-spatial-roomplan-24m2");
  const [claimId, setClaimId] = useState<string | null>("tour-demo-claim-water-ho3");
  const [jobData, setJobData] = useState<any | null>(null);
  const [isDemoMode, setIsDemoMode] = useState(true);
  const [isProcessing, setIsProcessing] = useState(false);
  const [policyDeductible, setPolicyDeductible] = useState<number>(1000);
  const [isLoading, setIsLoading] = useState(false);
  const [statusMessage, setStatusMessage] = useState("");
  const [svgContent, setSvgContent] = useState<string | null>(null);

  const driverRef = useRef<any>(null);

  // Load sample dataset from the dedicated tour API (/api/v1/tour)
  const handleLoadSample = async () => {
    setIsLoading(true);
    setStatusMessage("Fetching verified tour dataset from Tour Microservice...");
    try {
      // 1. Dedicated sample claim endpoint
      const res = await fetch("/api/v1/tour/sample-claim");
      if (!res.ok) throw new Error(`Tour service returned ${res.status}`);
      const data = await res.json();

      setJobId(data.job_id || "tour-demo-spatial-roomplan-24m2");
      setClaimId(data.claim_id || "tour-demo-claim-water-ho3");
      setJobData({
        job_id: data.job_id,
        areaM2: data.reconstruction?.room_area_m2 || 24.5,
        wallsCount: data.reconstruction?.wall_count || 4,
        errorEst: "±0.8 cm",
        tier: "Apple RoomPlan LiDAR",
        damageAreaM2: data.reconstruction?.damage_area_m2 || 18.2,
        plyUrl: "/api/v1/tour/artifacts/point_cloud.ply",
      });

      // 2. Fetch standalone floor plan SVG artifact
      const svgRes = await fetch("/api/v1/tour/artifacts/floor_plan.svg");
      if (svgRes.ok) {
        const svgText = await svgRes.text();
        setSvgContent(svgText);
      }

      setIsDemoMode(true);
      setStatusMessage("✓ Verified 24.5 m² sample scan & ISO HO-3 policy loaded from tour service.");
    } catch {
      // Fallback in case of network variance
      setJobData({
        job_id: "tour-demo-spatial-roomplan-24m2",
        areaM2: 24.5,
        wallsCount: 4,
        errorEst: "±0.8 cm",
        tier: "Apple RoomPlan LiDAR",
        damageAreaM2: 18.2,
        plyUrl: "/api/v1/tour/artifacts/point_cloud.ply",
      });
      setIsDemoMode(true);
      setStatusMessage("✓ Sample tour dataset active.");
    } finally {
      setIsLoading(false);
    }
  };

  // Automatically load tour sample dataset on page load so demo is instantly primed
  useEffect(() => {
    handleLoadSample();
  }, []);

  // Configure and start the Driver.js spotlight tour
  const startTour = () => {
    const driverObj = driver({
      showProgress: true,
      animate: true,
      allowClose: true,
      popoverClass: "claimspace-tour-popover",
      prevBtnText: "← Previous",
      nextBtnText: "Next Step →",
      doneBtnText: "Finish Tour",
      steps: [
        {
          element: "#tour-welcome-header",
          popover: {
            title: "Welcome to ClaimSpace Guided Tour",
            description:
              "This interactive spotlight tutorial will introduce you to our 4-phase spatial claim pipeline: turning phone camera footage into certified drawings, cross-referencing policy clauses with AI, and computing exact repair payouts.",
            side: "bottom",
            align: "start",
          },
        },
        {
          element: "#tour-workflow-tabs",
          popover: {
            title: "4-Phase Workflow Pipeline",
            description:
              "Claims advance systematically through four key milestones: Property Footage, Insurance Policy Ingestion, Itemized Cost Scheduling, and AI Chat Assistant guidance.",
            side: "bottom",
            align: "center",
          },
        },
        {
          element: "#tour-footage-upload",
          popover: {
            title: "1. Property Footage Ingestion",
            description:
              "Upload room photos, handheld video, or iPhone LiDAR exports. The system accepts standard mobile formats to initiate rapid spatial and geometric processing.",
            side: "top",
            align: "start",
          },
          onHighlightStarted: () => {
            setActiveTab("footage");
          },
        },
        {
          element: "#tour-spatial-viewer",
          popover: {
            title: "2. 3D & 2D Reconstruction Viewer",
            description:
              "Interact with the reconstructed 3D point cloud model, or toggle to the dimensioned 2D architectural blueprint with localized damage boundaries.",
            side: "top",
            align: "start",
          },
          onHighlightStarted: () => {
            setActiveTab("footage");
          },
        },
        {
          element: "#tour-workspace-card",
          popover: {
            title: "3. Insurance Policy Documents & Legal RAG",
            description:
              "Attach homeowner or commercial policy contracts. Our legal RAG engine correlates physical damages with policy clauses, verifies covered perils, identifies applicable exclusions, and confirms deductible and coverage limit terms.",
            side: "top",
            align: "start",
          },
          onHighlightStarted: () => {
            setActiveTab("policy");
          },
        },
        {
          element: "#tour-workspace-card",
          popover: {
            title: "4. Itemized Cost Calculation Engine",
            description:
              "Repair scopes link directly to the physical measurements captured in the 3D scan. The cost engine calculates required labor, materials, and contractor rates to produce transparent, itemized estimates and net claim payouts.",
            side: "top",
            align: "start",
          },
          onHighlightStarted: () => {
            setActiveTab("costs");
          },
        },
        {
          element: "#tour-workspace-card",
          popover: {
            title: "5. Conversational Claim Assistant",
            description:
              "Ask natural language questions regarding coverage status, deductible math, room geometry, or post-loss remediation steps. The assistant responds instantly citing policy page numbers and spatial measurements.",
            side: "top",
            align: "start",
          },
          onHighlightStarted: () => {
            setActiveTab("assistant");
          },
        },
      ],
      onDestroyStarted: () => {
        driverObj.destroy();
      },
    });

    driverRef.current = driverObj;
    driverObj.drive();
  };

  // Auto-launch driver tour on initial arrival after 800ms
  useEffect(() => {
    const timer = setTimeout(() => {
      startTour();
    }, 800);
    return () => clearTimeout(timer);
  }, []);

  const handlePolicyAnalyzed = (analysis: any) => {
    if (analysis && analysis.deductible != null) {
      setPolicyDeductible(analysis.deductible);
    }
  };

  return (
    <div className="min-h-screen flex flex-col selection:bg-[var(--accent)] selection:text-white">
      <Navbar />

      <main className="flex-1 py-6 sm:py-8 px-3 sm:px-6 lg:px-8">
        <div className="mx-auto max-w-6xl space-y-6 sm:space-y-8">
          {/* Welcome Header (Identical layout to User Console) */}
          <div
            id="tour-welcome-header"
            className="flex flex-col sm:flex-row sm:items-end justify-between gap-4 border-b pb-5 sm:pb-6"
            style={{ borderColor: "var(--border-subtle)" }}
          >
            <div className="space-y-1.5">
              <div className="flex items-center gap-2 flex-wrap">
                <span className="text-[11px] font-mono uppercase tracking-widest text-[var(--accent)] font-semibold">
                  Guided Tour Mode
                </span>
                <div className="inline-flex items-center gap-1.5 px-2 py-0.5 text-[11px] font-mono rounded border border-[var(--border-subtle)] text-[var(--text-muted)] bg-[var(--bg-surface)]">
                  <span>sample dataset · tour microservice</span>
                </div>
              </div>

              <h1 className="font-serif text-2xl sm:text-3xl md:text-4xl font-medium tracking-tight text-[var(--text-primary)] leading-tight">
                Claim & Reconstruction Overview
              </h1>
              <p className="text-xs text-[var(--text-secondary)]">
                Capture room dimensions, verify policy coverage, and calculate repair costs in minutes.
              </p>
            </div>

            {/* Actions in Header */}
            <div className="flex flex-col xs:flex-row sm:flex-row items-stretch sm:items-center gap-2 w-full sm:w-auto">
              <button
                id="tour-load-sample-btn"
                onClick={handleLoadSample}
                disabled={isLoading}
                className="btn-squish flex-1 sm:flex-initial inline-flex items-center justify-center gap-1.5 rounded-lg border px-3 py-2 text-xs font-medium text-[var(--text-primary)] shadow-sm hover:border-[var(--border-strong)] transition-all"
                style={{
                  backgroundColor: "var(--bg-surface)",
                  borderColor: "var(--border-default)",
                }}
              >
                <span className="h-1.5 w-1.5 rounded-full bg-[var(--accent)]" />
                {isLoading ? "Loading..." : "Load Sample Dataset"}
              </button>

              <button
                id="tour-start-btn"
                onClick={startTour}
                className="btn-squish flex-1 sm:flex-initial inline-flex items-center justify-center gap-1.5 rounded-lg px-3.5 py-2 text-xs font-semibold text-white shadow-sm transition-all"
                style={{
                  backgroundColor: "var(--accent)",
                }}
              >
                <span className="h-1.5 w-1.5 rounded-full bg-white animate-pulse" />
                <span>Start Guided Tour</span>
              </button>
            </div>
          </div>

          {/* Responsive Workflow Tabs (Identical layout to User Console) */}
          <div
            id="tour-workflow-tabs"
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

          {/* Active Workspace View (Identical container to User Console) */}
          <div
            id="tour-workspace-card"
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
                onJobLoaded={(data) => {
                  if (data.job_id) setJobId(data.job_id);
                  setJobData(data);
                }}
                isLoading={isLoading}
                setIsLoading={setIsLoading}
                statusMessage={statusMessage}
                setStatusMessage={setStatusMessage}
                isProcessing={isProcessing}
                setIsProcessing={setIsProcessing}
                isDemo={isDemoMode}
                jobData={jobData}
                onNavigateTab={(tab) => setActiveTab(tab)}
                allowSample={true}
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
                allowSample={true}
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
