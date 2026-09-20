"use client";

import React, { useState, useEffect } from "react";

interface CostLineItem {
  code: string;
  category: string;
  description: string;
  quantity: number;
  unit: string;
  unit_price: number;
  total: number;
}

interface CostEstimateSectionProps {
  claimId: string | null;
  policyDeductible?: number;
  jobData?: any | null;
  isProcessing?: boolean;
  isDemo?: boolean;
  onNavigateTab?: (tab: "footage" | "policy" | "costs" | "assistant") => void;
}

export default function CostEstimateSection({
  claimId,
  policyDeductible = 1000,
  jobData = null,
  isProcessing = false,
  isDemo = false,
  onNavigateTab,
}: CostEstimateSectionProps) {
  const [overheadProfitPct, setOverheadProfitPct] = useState(10);
  const [deductible, setDeductible] = useState(policyDeductible);
  const [mobileView, setMobileView] = useState<"cards" | "table">("cards");

  useEffect(() => {
    if (policyDeductible != null) {
      setDeductible(policyDeductible);
    }
  }, [policyDeductible]);

  const hasData = isDemo || (jobData && (jobData.areaM2 || jobData.room_area_m2));

  // Dynamic geometry derived from 3D spatial scan or sample data
  const roomAreaM2 = jobData?.areaM2 || jobData?.room_area_m2 || (isDemo ? 24.5 : 0);
  const wallPerimeterM = jobData?.walls
    ? jobData.walls.reduce((sum: number, w: any) => sum + (Number(w.length_m) || 0), 0)
    : (isDemo ? 19.8 : 0);

  // Use user-selected damageAreaM2 from interactive 2D floor plan if available
  const [activeDamageAreaM2, setActiveDamageAreaM2] = useState<number>(() => {
    if (jobData?.damageAreaM2 != null) return Number(jobData.damageAreaM2);
    return isDemo ? 18.2 : Number((roomAreaM2 * 0.74).toFixed(1));
  });

  // Sync if jobData.damageAreaM2 updates from 2D floor plan drag
  useEffect(() => {
    if (jobData?.damageAreaM2 != null) {
      setActiveDamageAreaM2(Number(jobData.damageAreaM2));
    }
  }, [jobData?.damageAreaM2]);

  // ==============================================================================
  // [PLACEHOLDER / HARDCODED RATES]
  // In production, these unit prices ($32.50, $28.00, $46.00, $112.00, $18.50, $22.00)
  // are dynamically retrieved from the Verisk Xactimate API, CoreLogic Symbility,
  // or Gordian RSMeans database based on the property zip code and current quarter.
  // ==============================================================================
  const lineItems: CostLineItem[] = [
    {
      code: "WTR-EXT-01",
      category: "Water Remediation",
      description: "Emergency surface water extraction & containment barriers",
      quantity: activeDamageAreaM2 || roomAreaM2,
      unit: "m²",
      unit_price: 32.5, // [HARDCODED PLACEHOLDER: $32.50/m²]
      total: (activeDamageAreaM2 || roomAreaM2) * 32.5,
    },
    {
      code: "DRW-REM-02",
      category: "Demolition",
      description: "Tear out water-damaged drywall (flood cut to 2ft perimeter)",
      quantity: Number((wallPerimeterM * 0.6).toFixed(1)),
      unit: "m²",
      unit_price: 28.0, // [HARDCODED PLACEHOLDER: $28.00/m²]
      total: wallPerimeterM * 0.6 * 28.0,
    },
    {
      code: "DRW-INS-03",
      category: "Drywall & Finish",
      description: "Install 5/8in moisture-resistant gypsum wallboard, taped & sanded",
      quantity: Number((wallPerimeterM * 0.6).toFixed(1)),
      unit: "m²",
      unit_price: 46.0, // [HARDCODED PLACEHOLDER: $46.00/m²]
      total: wallPerimeterM * 0.6 * 46.0,
    },
    {
      code: "FLR-OAK-04",
      category: "Flooring",
      description: "Remove buckled hardwood and install engineered White Oak plank",
      quantity: activeDamageAreaM2 || roomAreaM2,
      unit: "m²",
      unit_price: 112.0, // [HARDCODED PLACEHOLDER: $112.00/m²]
      total: (activeDamageAreaM2 || roomAreaM2) * 112.0,
    },
    {
      code: "PNT-WAL-05",
      category: "Painting",
      description: "Apply mildew-resistant primer and two coats acrylic eggshell finish",
      quantity: Number((wallPerimeterM * 2.7).toFixed(1)),
      unit: "m²",
      unit_price: 18.5, // [HARDCODED PLACEHOLDER: $18.50/m²]
      total: wallPerimeterM * 2.7 * 18.5,
    },
    {
      code: "TRM-CAR-06",
      category: "Finish Carpentry",
      description: "Replace 5-1/4in primed colonial baseboard & shoe moulding",
      quantity: Number(wallPerimeterM.toFixed(1)),
      unit: "lin m",
      unit_price: 22.0, // [HARDCODED PLACEHOLDER: $22.00/linear m]
      total: wallPerimeterM * 22.0,
    },
  ];

  const subtotal = lineItems.reduce((acc, item) => acc + item.total, 0);
  const overheadAndProfit = (subtotal * overheadProfitPct) / 100;
  const grossTotal = subtotal + overheadAndProfit;
  const netPayout = Math.max(0, grossTotal - deductible);

  // 1. Processing state view
  if (isProcessing) {
    return (
      <div className="space-y-6">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b pb-4" style={{ borderColor: "var(--border-subtle)" }}>
          <div>
            <h2 className="font-serif text-2xl font-medium tracking-tight text-[var(--text-primary)]">
              Cost Calculation & Repair Estimate
            </h2>
            <p className="text-xs text-[var(--text-secondary)] mt-1">
              Deterministic calculation engine waiting for 3D reconstruction measurements...
            </p>
          </div>
        </div>

        <div className="rounded-2xl border p-8 sm:p-12 flex flex-col items-center justify-center text-center bg-[var(--bg-card)] border-[var(--border-subtle)] space-y-4">
          <span className="h-8 w-8 rounded-full border-2 border-[var(--accent)] border-t-transparent animate-spin" />
          <div className="space-y-1">
            <h3 className="font-serif text-base font-semibold text-[var(--text-primary)]">
              Reconstructing 3D Geometry
            </h3>
            <p className="text-xs text-[var(--text-muted)] max-w-md">
              Calculating square footage, wall perimeters, and damage boundaries to populate itemized line items.
            </p>
          </div>
        </div>
      </div>
    );
  }

  // 2. Empty state view
  if (!hasData) {
    return (
      <div className="space-y-6">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b pb-4" style={{ borderColor: "var(--border-subtle)" }}>
          <div>
            <h2 className="font-serif text-2xl font-medium tracking-tight text-[var(--text-primary)]">
              Cost Calculation & Repair Estimate
            </h2>
            <p className="text-xs text-[var(--text-secondary)] mt-1">
              Deterministic calculation engine mapped to physical 3D spatial scan dimensions.
            </p>
          </div>
        </div>

        <div className="rounded-2xl border p-8 sm:p-12 flex flex-col items-center justify-center text-center bg-[var(--bg-card)] border-[var(--border-subtle)] space-y-4">
          <svg className="w-12 h-12 text-[var(--border-strong)]" viewBox="0 0 48 48" fill="none" stroke="currentColor" strokeWidth="1.5">
            <rect x="6" y="6" width="36" height="36" rx="4" strokeDasharray="4 3" />
            <path d="M14 24h20M24 14v20" strokeDasharray="2 2" strokeOpacity="0.5" />
          </svg>
          <div className="space-y-1">
            <h3 className="font-serif text-base font-semibold text-[var(--text-primary)]">
              No Physical Measurements Available
            </h3>
            <p className="text-xs text-[var(--text-muted)] max-w-sm">
              Please process room footage or select the interactive damage zone on Tab 1 to generate itemized costs.
            </p>
          </div>
          {onNavigateTab && (
            <button
              onClick={() => onNavigateTab("footage")}
              className="btn-squish inline-flex items-center gap-1.5 rounded-lg px-4 py-2 text-xs font-semibold text-white shadow-sm transition-all"
              style={{ backgroundColor: "var(--accent)" }}
            >
              Go to Property Footage & Floor Plan
            </button>
          )}
        </div>
      </div>
    );
  }

  // 3. Populated View
  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b pb-4" style={{ borderColor: "var(--border-subtle)" }}>
        <div>
          <div className="flex items-center gap-2">
            <h2 className="font-serif text-2xl font-medium tracking-tight text-[var(--text-primary)]">
              Cost Calculation & Repair Estimate
            </h2>
            <span className="px-2 py-0.5 rounded text-[11px] font-mono border border-[var(--border-subtle)] text-[var(--text-muted)] bg-[var(--bg-surface)]">
              {isDemo ? "sample estimate" : "live estimate"}
            </span>
          </div>
          <p className="text-xs text-[var(--text-secondary)] mt-1">
            Itemized repair schedule mapped directly to {roomAreaM2} m² total room area ({wallPerimeterM.toFixed(1)} m perimeter).
          </p>
        </div>

        <div className="flex items-center gap-2">
          <button
            onClick={() => window.print()}
            className="btn-squish inline-flex items-center gap-1.5 rounded-md border px-3 py-1.5 text-xs font-medium text-[var(--text-primary)] shadow-sm hover:border-[var(--border-strong)] transition-all"
            style={{
              backgroundColor: "var(--bg-card)",
              borderColor: "var(--border-default)",
            }}
          >
            Export Estimate Sheet
          </button>
        </div>
      </div>

      {/* LIVE DAMAGE AREA SYNC BANNER */}
      <div
        className="p-3.5 rounded-xl border flex flex-wrap items-center justify-between gap-3 text-xs"
        style={{
          backgroundColor: "var(--bg-surface)",
          borderColor: "var(--accent-subtle)",
        }}
      >
        <div className="flex items-center gap-2.5 flex-wrap">
          <span className="h-2 w-2 rounded-full bg-[var(--accent)] animate-pulse" />
          <span className="font-semibold text-[var(--text-primary)]">
            Selected Damage Area:
          </span>
          <span className="px-2 py-0.5 rounded font-mono font-bold text-[var(--accent)] bg-[var(--bg-card)] border border-[var(--border-subtle)]">
            {activeDamageAreaM2} m²
          </span>
          <span className="text-[var(--text-muted)]">
            ({((activeDamageAreaM2 / (roomAreaM2 || 24.5)) * 100).toFixed(0)}% of room · {(activeDamageAreaM2 * 10.764).toFixed(1)} sq ft)
          </span>
        </div>

        {/* Quick Stepper directly on Cost Tab */}
        <div className="flex items-center gap-2">
          <span className="text-[11px] text-[var(--text-muted)]">Adjust Area:</span>
          <button
            type="button"
            onClick={() => setActiveDamageAreaM2((prev) => Math.max(2.0, Number((prev - 1.0).toFixed(1))))}
            className="px-2 py-0.5 rounded border text-xs font-mono font-bold hover:bg-[var(--bg-card)] text-[var(--text-secondary)]"
            style={{ borderColor: "var(--border-default)" }}
          >
            -1 m²
          </button>
          <button
            type="button"
            onClick={() => setActiveDamageAreaM2((prev) => Math.min(roomAreaM2, Number((prev + 1.0).toFixed(1))))}
            className="px-2 py-0.5 rounded border text-xs font-mono font-bold hover:bg-[var(--bg-card)] text-[var(--text-secondary)]"
            style={{ borderColor: "var(--border-default)" }}
          >
            +1 m²
          </button>
        </div>
      </div>

      {/* Summary Stat Grid */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-2.5 sm:gap-4">
        <div className="p-3 sm:p-4 rounded-xl border" style={{ backgroundColor: "var(--bg-card)", borderColor: "var(--border-default)" }}>
          <div className="text-[10px] uppercase font-mono tracking-wider text-[var(--text-muted)]">Gross Repair Total</div>
          <div className="text-base sm:text-xl font-semibold text-[var(--text-primary)] mt-1 font-serif truncate">
            ${subtotal.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
          </div>
          <div className="text-[10px] sm:text-[11px] text-[var(--text-secondary)] mt-0.5 truncate">6 itemized scopes</div>
        </div>

        <div className="p-3 sm:p-4 rounded-xl border" style={{ backgroundColor: "var(--bg-card)", borderColor: "var(--border-default)" }}>
          <div className="text-[10px] uppercase font-mono tracking-wider text-[var(--text-muted)]">
            Contractor O&P ({overheadProfitPct}%)
          </div>
          <div className="text-base sm:text-xl font-semibold text-[var(--text-primary)] mt-1 font-serif truncate">
            ${overheadAndProfit.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
          </div>
          <div className="text-[10px] sm:text-[11px] text-[var(--text-secondary)] mt-0.5 truncate">Overhead & profit markup</div>
        </div>

        <div className="p-3 sm:p-4 rounded-xl border" style={{ backgroundColor: "var(--bg-card)", borderColor: "var(--border-default)" }}>
          <div className="text-[10px] uppercase font-mono tracking-wider text-[var(--text-muted)]">Policy Deductible</div>
          <div className="text-base sm:text-xl font-semibold text-rose-600 dark:text-rose-400 mt-1 font-serif truncate">
            -${deductible.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
          </div>
          <div className="text-[10px] sm:text-[11px] text-[var(--text-secondary)] mt-0.5 truncate">From policy document</div>
        </div>

        <div
          className="p-3 sm:p-4 rounded-xl border shadow-sm"
          style={{
            backgroundColor: "var(--bg-surface)",
            borderColor: "var(--accent)",
          }}
        >
          <div className="text-[10px] uppercase font-mono tracking-wider text-[var(--accent)] font-semibold">
            Net Claim Payout
          </div>
          <div className="text-lg sm:text-2xl font-bold text-[var(--text-primary)] mt-1 font-serif truncate">
            ${netPayout.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
          </div>
          <div className="text-[10px] sm:text-[11px] text-[var(--text-muted)] mt-0.5 truncate">
            {grossTotal <= deductible ? "Below deductible threshold" : "Estimated insurer check"}
          </div>
        </div>
      </div>

      {/* Interactive Adjustment Controls */}
      <div
        className="rounded-xl border p-4 sm:p-5 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 sm:gap-6"
        style={{
          backgroundColor: "var(--bg-surface)",
          borderColor: "var(--border-subtle)",
        }}
      >
        <div className="space-y-1">
          <div className="text-xs font-semibold text-[var(--text-primary)]">
            Policy & Calculation Overrides
          </div>
          <p className="text-xs text-[var(--text-secondary)]">
            Adjust deductible or contractor overhead & profit rate to reflect specific policy endorsements or contractor agreements.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-3 sm:gap-4 w-full sm:w-auto">
          <div className="flex items-center gap-2 flex-1 sm:flex-initial">
            <label className="text-xs font-medium text-[var(--text-secondary)] shrink-0">
              Deductible ($):
            </label>
            <input
              type="number"
              step="250"
              min="0"
              value={deductible}
              onChange={(e) => setDeductible(Number(e.target.value) || 0)}
              className="w-full sm:w-28 rounded-md border px-2.5 py-1 text-xs font-mono font-semibold text-[var(--text-primary)] focus:outline-none focus:ring-1 focus:ring-[var(--accent)]"
              style={{
                backgroundColor: "var(--bg-card)",
                borderColor: "var(--border-default)",
              }}
            />
          </div>

          <div className="flex items-center gap-2 flex-1 sm:flex-initial">
            <label className="text-xs font-medium text-[var(--text-secondary)] shrink-0">
              Contractor O&P:
            </label>
            <select
              value={overheadProfitPct}
              onChange={(e) => setOverheadProfitPct(Number(e.target.value))}
              className="w-full sm:w-auto rounded-md border px-2.5 py-1 text-xs text-[var(--text-primary)] focus:outline-none focus:ring-1 focus:ring-[var(--accent)]"
              style={{
                backgroundColor: "var(--bg-card)",
                borderColor: "var(--border-default)",
              }}
            >
              <option value="0">0% (None)</option>
              <option value="5">5% (Minor)</option>
              <option value="10">10% (Standard)</option>
              <option value="15">15% (Major)</option>
              <option value="20">20% (Full GC)</option>
            </select>
          </div>
        </div>
      </div>

      {/* Itemized Rate Section */}
      <div
        className="rounded-2xl border overflow-hidden"
        style={{
          backgroundColor: "var(--bg-card)",
          borderColor: "var(--border-default)",
        }}
      >
        <div className="px-4 sm:px-6 py-3.5 sm:py-4 border-b flex items-center justify-between flex-wrap gap-2" style={{ borderColor: "var(--border-subtle)" }}>
          <div className="flex items-baseline gap-3 flex-wrap">
            <span className="font-serif text-base font-semibold text-[var(--text-primary)]">
              Itemized Scope of Work
            </span>
            <span className="hidden sm:inline text-[11px] font-mono text-[var(--text-muted)]">
              Baseline Database: Standard US Restoration Averages
            </span>
          </div>

          <div className="flex items-center gap-2">
            {claimId && (
              <a
                href={`/api/v1/executions/${claimId}/pdf`}
                download
                className="text-xs font-mono px-3 py-1.5 rounded-lg border border-[var(--border-default)] text-[var(--text-primary)] hover:bg-[var(--bg-surface)] transition-colors cursor-pointer"
              >
                Download PDF Report
              </a>
            )}

            {/* Mobile view toggle */}
            <div className="flex md:hidden items-center gap-1 p-0.5 rounded-lg border text-xs" style={{ backgroundColor: "var(--bg-surface)", borderColor: "var(--border-subtle)" }}>
            <button
              onClick={() => setMobileView("cards")}
              className={`px-2 py-0.5 rounded font-mono text-[11px] transition-colors ${
                mobileView === "cards" ? "bg-[var(--bg-card)] text-[var(--text-primary)] font-semibold shadow-xs" : "text-[var(--text-muted)]"
              }`}
            >
              Cards
            </button>
            <button
              onClick={() => setMobileView("table")}
              className={`px-2 py-0.5 rounded font-mono text-[11px] transition-colors ${
                mobileView === "table" ? "bg-[var(--bg-card)] text-[var(--text-primary)] font-semibold shadow-xs" : "text-[var(--text-muted)]"
              }`}
            >
              Table
            </button>
          </div>
        </div>
      </div>

        {/* Mobile Cards View */}
        {mobileView === "cards" && (
          <div className="md:hidden divide-y" style={{ borderColor: "var(--border-subtle)" }}>
            {lineItems.map((item) => (
              <div key={item.code} className="p-4 space-y-2">
                <div className="flex items-center justify-between gap-2">
                  <div className="flex items-center gap-2">
                    <span className="font-mono text-xs font-semibold text-[var(--accent)]">{item.code}</span>
                    <span className="text-[10px] uppercase font-mono px-2 py-0.5 rounded bg-[var(--bg-surface)] text-[var(--text-muted)] border border-[var(--border-subtle)]">
                      {item.category}
                    </span>
                  </div>
                  <span className="font-mono text-sm font-semibold text-[var(--text-primary)]">
                    ${item.total.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                  </span>
                </div>
                <p className="text-xs text-[var(--text-primary)] font-medium leading-snug">
                  {item.description}
                </p>
                <div className="flex items-center justify-between text-[11px] font-mono text-[var(--text-secondary)] pt-1">
                  <span>Quantity: {item.quantity.toFixed(1)} {item.unit}</span>
                  <span>Rate: ${item.unit_price.toFixed(2)}/{item.unit}</span>
                </div>
              </div>
            ))}
          </div>
        )}

        {/* Desktop Table View */}
        <div className={`overflow-x-auto ${mobileView === "cards" ? "hidden md:block" : "block"}`}>
          <table className="w-full text-left text-xs min-w-[550px] sm:min-w-none">
            <thead>
              <tr
                className="border-b text-[10px] font-mono uppercase tracking-wider text-[var(--text-muted)]"
                style={{
                  backgroundColor: "var(--bg-surface)",
                  borderColor: "var(--border-subtle)",
                }}
              >
                <th className="py-3 px-4 sm:px-6">Code</th>
                <th className="py-3 px-3 sm:px-4">Category</th>
                <th className="py-3 px-4 sm:px-6">Description</th>
                <th className="py-3 px-3 sm:px-4 text-right">Quantity</th>
                <th className="py-3 px-3 sm:px-4 text-right">Unit Price</th>
                <th className="py-3 px-4 sm:px-6 text-right">Total ($)</th>
              </tr>
            </thead>
            <tbody className="divide-y" style={{ borderColor: "var(--border-subtle)" }}>
              {lineItems.map((item) => (
                <tr
                  key={item.code}
                  className="hover:bg-[var(--bg-surface)] transition-colors"
                >
                  <td className="py-3 px-4 sm:px-6 font-mono text-[11px] text-[var(--accent)] font-medium">
                    {item.code}
                  </td>
                  <td className="py-3 px-3 sm:px-4 text-[var(--text-secondary)]">
                    {item.category}
                  </td>
                  <td className="py-3 px-4 sm:px-6 text-[var(--text-primary)] font-medium">
                    {item.description}
                  </td>
                  <td className="py-3 px-3 sm:px-4 text-right font-mono text-[var(--text-primary)]">
                    {item.quantity.toFixed(1)} {item.unit}
                  </td>
                  <td className="py-3 px-3 sm:px-4 text-right font-mono text-[var(--text-secondary)]">
                    ${item.unit_price.toFixed(2)}
                  </td>
                  <td className="py-3 px-4 sm:px-6 text-right font-mono font-semibold text-[var(--text-primary)]">
                    ${item.total.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
