"use client";

import React, { useState, useEffect } from "react";
import Link from "next/link";
import Navbar from "@/components/Navbar";
import WalkthroughModal from "@/components/WalkthroughModal";
import ConsolePreview from "@/components/ConsolePreview";

export default function LandingPage() {
  const [isTourOpen, setIsTourOpen] = useState(false);

  // If the browser reloads with leftover '#interactive-preview' hash, clear it and remain at the top
  useEffect(() => {
    if (typeof window !== "undefined" && window.location.hash) {
      if (window.location.hash === "#interactive-preview") {
        window.history.replaceState(null, "", window.location.pathname);
        window.scrollTo(0, 0);
      }
    }
  }, []);

  return (
    <div className="min-h-screen flex flex-col selection:bg-[var(--accent)] selection:text-white">
      <Navbar onStartTour={() => setIsTourOpen(true)} />

      {/* Guided Walkthrough Modal */}
      <WalkthroughModal
        isOpen={isTourOpen}
        onClose={() => setIsTourOpen(false)}
        onNavigateTab={() => {
          // If on landing page and user navigates, redirect to portal
          window.location.href = "/portal";
        }}
      />

      <main className="flex-1">
        {/* Hero Section */}
        <section className="relative px-4 sm:px-6 lg:px-8 pt-10 pb-14 sm:pt-20 sm:pb-24 overflow-hidden">
          {/* Subtle background gradient and dot grid */}
          <div
            className="absolute inset-0 -z-10 opacity-30 pointer-events-none"
            style={{
              backgroundImage:
                "radial-gradient(var(--border-strong) 1px, transparent 1px)",
              backgroundSize: "24px 24px",
            }}
          />

          <div className="mx-auto max-w-4xl text-center space-y-6 sm:space-y-8">
            {/* Top Pill Badge */}
            <div className="inline-flex items-center gap-2 rounded-full border px-3.5 py-1 text-xs font-mono font-medium text-[var(--text-secondary)] shadow-sm"
              style={{
                backgroundColor: "var(--bg-card)",
                borderColor: "var(--border-default)",
              }}
            >
              <span className="h-1.5 w-1.5 rounded-full bg-[var(--accent)] animate-pulse" />
              <span>Spatial Claims & Reconstruction Platform</span>
            </div>

            {/* Main Headline */}
            <h1 className="font-serif text-3xl sm:text-5xl lg:text-7xl font-medium tracking-tight text-[var(--text-primary)] leading-[1.12] sm:leading-[1.08]">
              From Smartphone Capture to Accurate Floor Plans & Instant Estimates.
            </h1>

            {/* Subheading */}
            <p className="mx-auto max-w-2xl text-sm sm:text-lg text-[var(--text-secondary)] leading-relaxed font-sans px-2">
              Transform room photos, walkthrough video, or iPhone LiDAR exports into certified 2D architectural drawings, verify insurance coverage clauses, and calculate repair payouts without waiting weeks for an adjuster.
            </p>

            {/* Action Buttons */}
            <div className="flex flex-col sm:flex-row items-center justify-center gap-3 pt-2 w-full max-w-md mx-auto sm:max-w-none">
              <Link
                href="/portal"
                className="btn-squish w-full sm:w-auto inline-flex items-center justify-center rounded-xl px-6 py-3.5 text-sm font-semibold text-white shadow-sm transition-all text-center"
                style={{
                  backgroundColor: "var(--accent)",
                }}
              >
                Launch User Console
              </Link>

              <Link
                href="/tour"
                className="btn-squish w-full sm:w-auto inline-flex items-center justify-center rounded-xl border px-6 py-3.5 text-sm font-medium text-[var(--text-primary)] shadow-sm hover:border-[var(--border-strong)] transition-all text-center"
                style={{
                  backgroundColor: "var(--bg-card)",
                  borderColor: "var(--border-default)",
                }}
              >
                Start Guided Tour
              </Link>
            </div>

            {/* Trust / Metric Strip */}
            <div className="pt-6 sm:pt-8 border-t max-w-3xl mx-auto grid grid-cols-2 sm:grid-cols-4 gap-4 sm:gap-6 text-center" style={{ borderColor: "var(--border-subtle)" }}>
              <div className="p-2">
                <div className="font-serif text-xl sm:text-2xl font-semibold text-[var(--text-primary)]">±0.8 cm</div>
                <div className="text-[10px] sm:text-[11px] text-[var(--text-muted)] uppercase tracking-wider font-mono mt-0.5">LiDAR Precision</div>
              </div>
              <div className="p-2">
                <div className="font-serif text-xl sm:text-2xl font-semibold text-[var(--text-primary)]">100%</div>
                <div className="text-[10px] sm:text-[11px] text-[var(--text-muted)] uppercase tracking-wider font-mono mt-0.5">ISO HO-3 Compatible</div>
              </div>
              <div className="p-2">
                <div className="font-serif text-xl sm:text-2xl font-semibold text-[var(--text-primary)]">&lt; 3 Min</div>
                <div className="text-[10px] sm:text-[11px] text-[var(--text-muted)] uppercase tracking-wider font-mono mt-0.5">Estimate Generation</div>
              </div>
              <div className="p-2">
                <div className="font-serif text-xl sm:text-2xl font-semibold text-[var(--text-primary)]">24 / 7</div>
                <div className="text-[10px] sm:text-[11px] text-[var(--text-muted)] uppercase tracking-wider font-mono mt-0.5">Claim Intelligence</div>
              </div>
            </div>
          </div>
        </section>

        {/* Live Interactive User Console Sandbox Preview */}
        <section
          id="interactive-preview"
          className="px-4 sm:px-6 lg:px-8 py-12 sm:py-16 border-t scroll-mt-6"
          style={{
            borderColor: "var(--border-subtle)",
            backgroundColor: "var(--bg-page)",
          }}
        >
          <div className="mx-auto max-w-6xl space-y-8">
            <div className="text-center max-w-3xl mx-auto space-y-3">
              <span className="text-xs font-mono uppercase tracking-widest text-[var(--accent)] font-semibold">
                Interactive Product Playground
              </span>
              <h2 className="font-serif text-3xl sm:text-4xl lg:text-5xl font-medium tracking-tight text-[var(--text-primary)]">
                Experience the Platform in Action
              </h2>
              <p className="text-xs sm:text-sm text-[var(--text-secondary)] leading-relaxed max-w-2xl mx-auto">
                Test the actual user console below: drag and orbit the real-time 3D point cloud, chat with the AI claims assistant, and inspect verified policy coverage and calculated payouts.
              </p>
            </div>

            {/* Embedded Live Console Component */}
            <ConsolePreview />
          </div>
        </section>

        {/* Core Pillars / Feature Showcase Section */}
        <section className="px-4 sm:px-6 lg:px-8 py-20 border-t" style={{ borderColor: "var(--border-subtle)", backgroundColor: "var(--bg-surface)" }}>
          <div className="mx-auto max-w-7xl space-y-16">
            <div className="max-w-2xl">
              <span className="text-xs font-mono uppercase tracking-widest text-[var(--accent)] font-semibold">
                Core Capabilities
              </span>
              <h2 className="font-serif text-3xl sm:text-4xl font-medium tracking-tight text-[var(--text-primary)] mt-2">
                A complete closed-loop spatial and claims engine.
              </h2>
              <p className="text-sm text-[var(--text-secondary)] mt-3 leading-relaxed">
                Traditional property claims involve fragmented measuring tapes, disputed damage surfaces, and tedious manual policy reading. ClaimSpace orchestrates everything in one unified workspace.
              </p>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
              {/* Feature 1 */}
              <div
                className="rounded-2xl border p-7 flex flex-col justify-between space-y-6 transition-all hover:shadow-md"
                style={{
                  backgroundColor: "var(--bg-card)",
                  borderColor: "var(--border-default)",
                }}
              >
                <div className="space-y-3">
                  <span className="text-xs font-mono text-[var(--accent)] font-semibold">01 / Spatial Capture</span>
                  <h3 className="font-serif text-xl font-medium text-[var(--text-primary)]">
                    Multi-Modal Visual & LiDAR Ingestion
                  </h3>
                  <p className="text-xs text-[var(--text-secondary)] leading-relaxed">
                    Upload overlapping photos from any mobile device, standard walk-around video footage, or raw Apple RoomPlan LiDAR files. The photogrammetry pipeline resolves dense 3D point clouds and room boundaries.
                  </p>
                </div>
                <div
                  className="rounded-xl border p-4 text-[11px] font-mono text-[var(--text-muted)]"
                  style={{
                    backgroundColor: "var(--bg-surface)",
                    borderColor: "var(--border-subtle)",
                  }}
                >
                  Formats: JPG · PNG · MP4 · MOV · USDZ · PLY
                </div>
              </div>

              {/* Feature 2 */}
              <div
                className="rounded-2xl border p-7 flex flex-col justify-between space-y-6 transition-all hover:shadow-md"
                style={{
                  backgroundColor: "var(--bg-card)",
                  borderColor: "var(--border-default)",
                }}
              >
                <div className="space-y-3">
                  <span className="text-xs font-mono text-[var(--accent)] font-semibold">02 / Floor Plan Engine</span>
                  <h3 className="font-serif text-xl font-medium text-[var(--text-primary)]">
                    Architectural 2D Drawings & Wall Segments
                  </h3>
                  <p className="text-xs text-[var(--text-secondary)] leading-relaxed">
                    Extracts precise wall segments, square meters, door swings, and window openings. Automatically generates industry-standard SVG floor plans and DXF CAD exports for contractors and adjusters.
                  </p>
                </div>
                <div
                  className="rounded-xl border p-4 text-[11px] font-mono text-[var(--text-muted)]"
                  style={{
                    backgroundColor: "var(--bg-surface)",
                    borderColor: "var(--border-subtle)",
                  }}
                >
                  Deliverables: SVG · DXF · PLY Point Cloud · JSON
                </div>
              </div>

              {/* Feature 3 */}
              <div
                className="rounded-2xl border p-7 flex flex-col justify-between space-y-6 transition-all hover:shadow-md"
                style={{
                  backgroundColor: "var(--bg-card)",
                  borderColor: "var(--border-default)",
                }}
              >
                <div className="space-y-3">
                  <span className="text-xs font-mono text-[var(--accent)] font-semibold">03 / Policy Intelligence</span>
                  <h3 className="font-serif text-xl font-medium text-[var(--text-primary)]">
                    Section-Aware Insurance Document RAG
                  </h3>
                  <p className="text-xs text-[var(--text-secondary)] leading-relaxed">
                    Attach your homeowner or commercial insurance policy PDF. Our retrieval-augmented engine indexes policy sections, cross-references causes of loss against covered perils, and cites exact exclusion clauses.
                  </p>
                </div>
                <div
                  className="rounded-xl border p-4 text-[11px] font-mono text-[var(--text-muted)]"
                  style={{
                    backgroundColor: "var(--bg-surface)",
                    borderColor: "var(--border-subtle)",
                  }}
                >
                  Policies: ISO HO-3 · HO-5 · Commercial Property
                </div>
              </div>

              {/* Feature 4 */}
              <div
                className="rounded-2xl border p-7 flex flex-col justify-between space-y-6 transition-all hover:shadow-md"
                style={{
                  backgroundColor: "var(--bg-card)",
                  borderColor: "var(--border-default)",
                }}
              >
                <div className="space-y-3">
                  <span className="text-xs font-mono text-[var(--accent)] font-semibold">04 / Cost Calculation</span>
                  <h3 className="font-serif text-xl font-medium text-[var(--text-primary)]">
                    Deterministic Repair Schedule & Payouts
                  </h3>
                  <p className="text-xs text-[var(--text-secondary)] leading-relaxed">
                    Combines measured physical geometry directly with standardized repair rate tables. Computes drywall removal, subfloor drying, oak flooring replacement, contractor O&P, and deductibles with total transparency.
                  </p>
                </div>
                <div
                  className="rounded-xl border p-4 text-[11px] font-mono text-[var(--text-muted)]"
                  style={{
                    backgroundColor: "var(--bg-surface)",
                    borderColor: "var(--border-subtle)",
                  }}
                >
                  Standards: Xactimate item codes · O&P 10/10
                </div>
              </div>

              {/* Feature 5 */}
              <div
                className="rounded-2xl border p-7 flex flex-col justify-between space-y-6 transition-all hover:shadow-md"
                style={{
                  backgroundColor: "var(--bg-card)",
                  borderColor: "var(--border-default)",
                }}
              >
                <div className="space-y-3">
                  <span className="text-xs font-mono text-[var(--accent)] font-semibold">05 / Claim QA Assistant</span>
                  <h3 className="font-serif text-xl font-medium text-[var(--text-primary)]">
                    Multi-Intent Natural Language Guidance
                  </h3>
                  <p className="text-xs text-[var(--text-secondary)] leading-relaxed">
                    Ask any question in plain language. The conversational assistant intelligently routes inquiries between legal policy coverage, physical 3D scan dimensions, repair pricing, or mandatory policyholder duties.
                  </p>
                </div>
                <div
                  className="rounded-xl border p-4 text-[11px] font-mono text-[var(--text-muted)]"
                  style={{
                    backgroundColor: "var(--bg-surface)",
                    borderColor: "var(--border-subtle)",
                  }}
                >
                  Routing: POLICY · COST · GEOMETRY · GENERAL
                </div>
              </div>

              {/* Feature 6 / CTA Card */}
              <div
                className="rounded-2xl border p-7 flex flex-col justify-between space-y-6"
                style={{
                  backgroundColor: "var(--bg-card-subtle)",
                  borderColor: "var(--border-default)",
                }}
              >
                <div className="space-y-3">
                  <span className="text-xs font-mono text-[var(--accent)] font-semibold">06 / Ready to Begin?</span>
                  <h3 className="font-serif text-xl font-medium text-[var(--text-primary)]">
                    Experience the Platform in 1 Click
                  </h3>
                  <p className="text-xs text-[var(--text-secondary)] leading-relaxed">
                    No files required. You can load our pre-indexed 24.5 m² sample room scan and standard 22-page ISO HO-3 policy to test the entire pipeline end-to-end.
                  </p>
                </div>
                <Link
                  href="/tour"
                  className="btn-squish inline-flex items-center justify-center rounded-xl px-5 py-3 text-xs font-semibold text-white shadow-sm transition-all"
                  style={{
                    backgroundColor: "var(--accent)",
                  }}
                >
                  Start Guided Tour →
                </Link>
              </div>
            </div>
          </div>
        </section>
      </main>

      {/* Classy Editorial Footer */}
      <footer className="border-t py-12 px-4 sm:px-6 lg:px-8" style={{ borderColor: "var(--border-subtle)", backgroundColor: "var(--bg-page)" }}>
        <div className="mx-auto max-w-7xl flex flex-col sm:flex-row items-center justify-between gap-6">
          <div className="flex items-center gap-3">
            <span
              className="flex h-7 w-7 items-center justify-center rounded-lg border font-serif text-sm font-semibold"
              style={{
                borderColor: "var(--border-default)",
                backgroundColor: "var(--bg-surface)",
                color: "var(--accent)",
              }}
            >
              C
            </span>
            <span className="font-serif text-base font-medium text-[var(--text-primary)]">
              ClaimSpace 3D
            </span>
            <span className="text-xs text-[var(--text-muted)]">
              · Verified Spatial Claims Engine
            </span>
          </div>

          <div className="flex items-center gap-6 text-xs text-[var(--text-secondary)]">
            <Link href="/" className="hover:text-[var(--text-primary)] transition-colors">Overview</Link>
            <Link href="/tour" className="hover:text-[var(--text-primary)] transition-colors">Guided Tour</Link>
            <Link href="/portal" className="hover:text-[var(--text-primary)] transition-colors">User Portal</Link>
            <Link href="/login" className="hover:text-[var(--text-primary)] transition-colors">Sign In</Link>
            <Link href="/profile" className="hover:text-[var(--text-primary)] transition-colors">Profile</Link>
            <Link href="/admin" className="hover:text-[var(--text-primary)] transition-colors">Admin Console</Link>
          </div>
        </div>
      </footer>
    </div>
  );
}
