"use client";

import React, { useState } from "react";

interface WalkthroughModalProps {
  isOpen: boolean;
  onClose: () => void;
  onNavigateTab?: (tabKey: string) => void;
}

interface Step {
  title: string;
  subtitle: string;
  content: string;
  tabTarget?: string;
  highlightText: string;
}

export default function WalkthroughModal({
  isOpen,
  onClose,
  onNavigateTab,
}: WalkthroughModalProps) {
  const [currentStep, setCurrentStep] = useState(0);

  const steps: Step[] = [
    {
      title: "Welcome to Your Claim Workspace",
      subtitle: "Step 1 of 5 · System Overview",
      content:
        "You can turn smartphone photos, video walkthroughs, or LiDAR scans into verified 2D floor plans, analyze policy terms with AI, and calculate exact repair payouts in minutes. This walkthrough guides you through each capability.",
      highlightText:
        "Designed specifically for property owners and adjusters seeking clarity without bureaucratic delays.",
    },
    {
      title: "Upload Property Footage",
      subtitle: "Step 2 of 5 · Media Ingestion",
      tabTarget: "footage",
      content:
        "Here, you can upload room photos, a walkthrough video, or an iPhone LiDAR export. When starting fresh, your workspace remains clean. You can load a sample 3D scan anytime to explore interactive drawings and 3D models.",
      highlightText:
        "Sample preview datasets are labeled distinctively, keeping your own property claims separate.",
    },
    {
      title: "Insurance Policy Documents",
      subtitle: "Step 3 of 5 · Legal Clause Ingestion",
      tabTarget: "policy",
      content:
        "You can attach your homeowner or commercial policy PDF here. The retrieval engine parses exact policy forms (e.g., ISO HO-3) to identify covered perils, applicable deductibles, and exclusion clauses.",
      highlightText:
        "Receive clear, cited legal opinions explaining whether your damages are covered.",
    },
    {
      title: "Itemized Cost Estimation",
      subtitle: "Step 4 of 5 · Cost Engine",
      tabTarget: "costs",
      content:
        "Here, you can review deterministic repair line items — including drywall replacement, hardwood flooring, and paint. You can adjust contractor overhead and profit or deductible amounts to see your net payout.",
      highlightText:
        "All calculations map directly to the square meters measured in your 3D spatial scan.",
    },
    {
      title: "Conversational Claim Assistant",
      subtitle: "Step 5 of 5 · Real-time Guidance",
      tabTarget: "assistant",
      content:
        "You can ask any question about your claim in natural language. Whether inquiring about burst pipe coverage, policy duties after a loss, or room dimensions, your assistant cites exact clauses and measurements.",
      highlightText:
        "Available around the clock to support your documentation and adjuster communications.",
    },
  ];

  if (!isOpen) return null;

  const step = steps[currentStep];

  const handleNext = () => {
    if (currentStep < steps.length - 1) {
      const nextIndex = currentStep + 1;
      setCurrentStep(nextIndex);
      if (steps[nextIndex].tabTarget && onNavigateTab) {
        onNavigateTab(steps[nextIndex].tabTarget);
      }
    } else {
      onClose();
    }
  };

  const handlePrev = () => {
    if (currentStep > 0) {
      const prevIndex = currentStep - 1;
      setCurrentStep(prevIndex);
      if (steps[prevIndex].tabTarget && onNavigateTab) {
        onNavigateTab(steps[prevIndex].tabTarget);
      }
    }
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      className="fixed inset-0 z-50 flex items-center justify-center p-4 sm:p-6"
    >
      {/* Dimmed Backdrop */}
      <div
        className="fixed inset-0 bg-black/40 backdrop-blur-sm transition-opacity"
        onClick={onClose}
      />

      {/* Modal Card */}
      <div
        className="relative z-10 w-full max-w-lg rounded-2xl border p-6 sm:p-8 shadow-2xl transition-all"
        style={{
          backgroundColor: "var(--bg-card)",
          borderColor: "var(--border-default)",
          boxShadow: "var(--shadow-card)",
        }}
      >
        {/* Step Indicator & Close */}
        <div className="flex items-center justify-between border-b pb-4" style={{ borderColor: "var(--border-subtle)" }}>
          <div className="flex items-center gap-2">
            <span
              className="px-2 py-0.5 text-[11px] font-mono font-medium uppercase tracking-wider rounded"
              style={{
                backgroundColor: "var(--badge-bg)",
                color: "var(--badge-text)",
              }}
            >
              {step.subtitle}
            </span>
          </div>
          <button
            onClick={onClose}
            className="text-xs font-medium text-[var(--text-muted)] hover:text-[var(--text-primary)] transition-colors"
          >
            Skip Walkthrough
          </button>
        </div>

        {/* Modal Body */}
        <div className="mt-6 space-y-4">
          <h3 className="font-serif text-2xl font-medium tracking-tight text-[var(--text-primary)]">
            {step.title}
          </h3>
          <p className="text-sm leading-relaxed text-[var(--text-secondary)]">
            {step.content}
          </p>
          <div
            className="rounded-lg border p-3.5 text-xs leading-relaxed text-[var(--text-primary)]"
            style={{
              backgroundColor: "var(--bg-surface)",
              borderColor: "var(--border-subtle)",
            }}
          >
            <span className="font-semibold text-[var(--accent)]">Key Insight: </span>
            {step.highlightText}
          </div>
        </div>

        {/* Footer Navigation */}
        <div className="mt-8 flex items-center justify-between pt-4 border-t" style={{ borderColor: "var(--border-subtle)" }}>
          {/* Progress Dots */}
          <div className="flex items-center gap-1.5">
            {steps.map((_, i) => (
              <button
                key={i}
                onClick={() => {
                  setCurrentStep(i);
                  if (steps[i].tabTarget && onNavigateTab) {
                    onNavigateTab(steps[i].tabTarget);
                  }
                }}
                className={`h-1.5 rounded-full transition-all ${
                  i === currentStep
                    ? "w-6 bg-[var(--accent)]"
                    : "w-1.5 bg-[var(--border-strong)] hover:bg-[var(--text-muted)]"
                }`}
                aria-label={`Go to step ${i + 1}`}
              />
            ))}
          </div>

          {/* Action Buttons */}
          <div className="flex items-center gap-2">
            {currentStep > 0 && (
              <button
                onClick={handlePrev}
                className="btn-squish rounded-md border px-3 py-1.5 text-xs font-medium text-[var(--text-secondary)] hover:text-[var(--text-primary)] transition-colors"
                style={{
                  borderColor: "var(--border-default)",
                  backgroundColor: "var(--bg-surface)",
                }}
              >
                Previous
              </button>
            )}
            <button
              onClick={handleNext}
              className="btn-squish rounded-md px-4 py-1.5 text-xs font-medium text-white shadow-sm transition-all"
              style={{
                backgroundColor: "var(--accent)",
              }}
            >
              {currentStep === steps.length - 1 ? "Get Started" : "Continue"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
