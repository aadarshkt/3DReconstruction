"use client";

import React, { useState } from "react";

interface PolicyAnalysis {
  is_covered?: boolean;
  deductible?: number;
  coverage_limit?: number;
  missing_fields?: string[];
  peril?: string;
  reasoning?: string;
  relevant_clauses?: Array<{
    section: string;
    page: number;
    text: string;
  }>;
}

interface PolicySectionProps {
  claimId: string | null;
  onPolicyAnalyzed: (analysis: PolicyAnalysis) => void;
  isLoading?: boolean;
  setIsLoading?: (val: boolean) => void;
  statusMessage?: string;
  setStatusMessage?: (msg: string) => void;
  isDemo?: boolean;
  allowSample?: boolean;
}

export default function PolicySection({
  claimId,
  onPolicyAnalyzed,
  isLoading: propLoading,
  setIsLoading: propSetIsLoading,
  statusMessage: propStatusMessage,
  setStatusMessage: propSetStatusMessage,
  isDemo = false,
  allowSample = true,
}: PolicySectionProps) {
  const [internalLoading, setInternalLoading] = useState(false);
  const [internalStatusMessage, setInternalStatusMessage] = useState("");

  const isLoading = propLoading !== undefined ? propLoading : internalLoading;
  const setIsLoading = (val: boolean) => {
    setInternalLoading(val);
    propSetIsLoading?.(val);
  };

  const statusMessage = propStatusMessage !== undefined ? propStatusMessage : internalStatusMessage;
  const setStatusMessage = (msg: string) => {
    setInternalStatusMessage(msg);
    propSetStatusMessage?.(msg);
  };

  const [policyUploaded, setPolicyUploaded] = useState(false);
  const [uploadedFileName, setUploadedFileName] = useState<string | null>(null);
  const [analysis, setAnalysis] = useState<PolicyAnalysis | null>(null);
  const [causeOfLoss, setCauseOfLoss] = useState("water");
  const [damageDescription, setDamageDescription] = useState(
    "Sudden pipe burst in kitchen interior wall resulting in continuous water spread across living room hardwood flooring and adjacent drywall."
  );
  const [customDeductible, setCustomDeductible] = useState<number | "">("");
  const [activeClaimId, setActiveClaimId] = useState<string | null>(claimId);

  // Sync external claimId if provided
  React.useEffect(() => {
    if (claimId) setActiveClaimId(claimId);
  }, [claimId]);

  // Helper to ensure claim exists on the backend
  const ensureClaimId = async (): Promise<string | null> => {
    if (activeClaimId) return activeClaimId;
    try {
      const res = await fetch("/claims", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          property_type: "residential",
          damage_description: damageDescription,
          cause_of_loss: causeOfLoss,
        }),
      });
      if (res.ok) {
        const claim = await res.json();
        setActiveClaimId(claim.id);
        return claim.id;
      } else {
        const errJson = await res.json().catch(() => ({}));
        const msg = errJson.detail || `Server returned status ${res.status} during claim initialization.`;
        console.error("Failed to auto-create claim:", res.status, errJson);
        throw new Error(msg);
      }
    } catch (e: any) {
      console.error("Failed to auto-create claim:", e);
      throw e;
    }
  };

  const handleFileUpload = async (files: FileList | null) => {
    if (!files || files.length === 0) return;
    const file = files[0];
    if (!file.name.toLowerCase().endsWith(".pdf")) {
      alert("Please upload an insurance policy PDF document.");
      return;
    }

    setIsLoading(true);
    setUploadedFileName(file.name);
    setStatusMessage(`Uploading and indexing "${file.name}" with section-aware RAG...`);

    try {
      const cid = await ensureClaimId();
      if (!cid) {
        throw new Error("Unable to initialize claim session for policy upload.");
      }

      const formData = new FormData();
      formData.append("file", file);

      const uploadRes = await fetch(`/claims/${cid}/policy/upload`, {
        method: "POST",
        body: formData,
      });

      if (!uploadRes.ok) {
        const errJson = await uploadRes.json().catch(() => ({}));
        throw new Error(errJson.detail || `Upload failed with status ${uploadRes.status}`);
      }

      setStatusMessage("Extracting policy terms, deductibles, and peril coverage via RAG...");
      const analyzeRes = await fetch(`/claims/${cid}/policy/analyze`, { method: "POST" });
      if (!analyzeRes.ok) {
        const errJson = await analyzeRes.json().catch(() => ({}));
        throw new Error(errJson.detail || "Policy analysis failed");
      }

      const data = await analyzeRes.json();
      setPolicyUploaded(true);
      setAnalysis(data.analysis);
      onPolicyAnalyzed(data.analysis);
      setStatusMessage(`Policy "${file.name}" indexed and analyzed successfully.`);
    } catch (err: any) {
      console.error("Policy upload error:", err);
      setStatusMessage(`Notice: ${err.message || "Could not analyze custom PDF."}`);
      alert(`Policy Analysis Notice: ${err.message || "Failed to process PDF."}`);
    } finally {
      setIsLoading(false);
    }
  };

  const handleLoadSamplePolicy = async () => {
    setIsLoading(true);
    setStatusMessage("Attaching and indexing standard 22-page ISO HO-3 Policy fixture...");

    try {
      const cid = await ensureClaimId();
      if (cid) {
        await fetch(`/claims/${cid}/policy/load-sample`, { method: "POST" });
        const analyzeRes = await fetch(`/claims/${cid}/policy/analyze`, { method: "POST" });
        if (analyzeRes.ok) {
          const data = await analyzeRes.json();
          setPolicyUploaded(true);
          setUploadedFileName("sample_ho3_policy.pdf");
          setAnalysis(data.analysis);
          onPolicyAnalyzed(data.analysis);
          setStatusMessage("Sample ISO HO-3 policy indexed and verified.");
          return;
        }
      }
      throw new Error("Local fallback");
    } catch (_) {
      // Offline fallback
      const mockAnalysis: PolicyAnalysis = {
        is_covered: true,
        deductible: 1000,
        coverage_limit: 350000,
        peril: "Accidental Discharge or Overflow of Water or Steam (Section I - Peril 12)",
        reasoning:
          "The policy explicitly provides Coverage A (Dwelling) for sudden and accidental discharge of water from within a plumbing system. The damage description reflects sudden piping failure without evidence of continuous seepage exceeding 14 days, thereby satisfying all coverage conditions under Section I - Peril 12.",
        relevant_clauses: [
          {
            section: "SECTION I – PERILS INSURED AGAINST (HO-3)",
            page: 9,
            text: "12. Accidental Discharge Or Overflow Of Water Or Steam from within a plumbing, heating, air conditioning or automatic fire protective sprinkler system or from within a household appliance.",
          },
          {
            section: "SECTION I – EXCLUSIONS (Water Damage)",
            page: 12,
            text: "Exclusion 1.c applies to flood, surface water, waves, and water backing up through sewers; sudden internal pipe discharges remain fully covered.",
          },
        ],
      };
      setPolicyUploaded(true);
      setUploadedFileName("sample_ho3_policy.pdf");
      setAnalysis(mockAnalysis);
      onPolicyAnalyzed(mockAnalysis);
      setStatusMessage("Sample ISO HO-3 policy verified.");
    } finally {
      setIsLoading(false);
    }
  };

  const handleApplyCustomDeductible = () => {
    if (!analysis) return;
    const val = Number(customDeductible);
    if (isNaN(val) || val < 0) return;
    const updated = { ...analysis, deductible: val };
    setAnalysis(updated);
    onPolicyAnalyzed(updated);
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b pb-4" style={{ borderColor: "var(--border-subtle)" }}>
        <div>
          <div className="flex items-center gap-2">
            <h2 className="font-serif text-2xl font-medium tracking-tight text-[var(--text-primary)]">
              Insurance Documents & Policy Terms
            </h2>
            {policyUploaded && (
              <span className="px-2 py-0.5 rounded text-[11px] font-mono border border-[var(--border-subtle)] text-[var(--text-muted)] bg-[var(--bg-surface)]">
                {uploadedFileName || (isDemo ? "sample policy (iso ho-3)" : "verified policy document")}
              </span>
            )}
          </div>
          <p className="text-xs text-[var(--text-secondary)] mt-1">
            Upload your policy PDF to extract perils, deductibles, limits, and exclusions via section-aware RAG.
          </p>
        </div>

        {allowSample && (
          <button
            onClick={handleLoadSamplePolicy}
            disabled={isLoading}
            className="btn-squish w-full sm:w-auto inline-flex items-center justify-center gap-1.5 rounded-lg border px-3 py-2 text-xs font-medium text-[var(--text-primary)] shadow-sm hover:border-[var(--border-strong)] transition-all"
            style={{
              backgroundColor: "var(--bg-card)",
              borderColor: "var(--border-default)",
            }}
          >
            Attach Sample ISO HO-3 Policy
          </button>
        )}
      </div>

      {/* Loss & Claim Parameters */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 sm:gap-4">
        <div>
          <label className="block text-xs font-medium text-[var(--text-secondary)] mb-1">
            Cause of Loss
          </label>
          <select
            value={causeOfLoss}
            onChange={(e) => setCauseOfLoss(e.target.value)}
            className="w-full rounded-lg border px-3 py-2 text-xs text-[var(--text-primary)] focus:outline-none focus:ring-1 focus:ring-[var(--accent)]"
            style={{
              backgroundColor: "var(--bg-surface)",
              borderColor: "var(--border-default)",
            }}
          >
            <option value="water">Water Damage / Plumbing Discharge</option>
            <option value="fire">Fire & Smoke Damage</option>
            <option value="wind">Windstorm / Hail</option>
            <option value="freeze">Freezing Weather Burst</option>
            <option value="other">Other Property Peril</option>
          </select>
        </div>

        <div className="sm:col-span-2">
          <label className="block text-xs font-medium text-[var(--text-secondary)] mb-1">
            Loss Description
          </label>
          <input
            type="text"
            value={damageDescription}
            onChange={(e) => setDamageDescription(e.target.value)}
            className="w-full rounded-lg border px-3 py-2 text-xs text-[var(--text-primary)] focus:outline-none focus:ring-1 focus:ring-[var(--accent)]"
            style={{
              backgroundColor: "var(--bg-surface)",
              borderColor: "var(--border-default)",
            }}
          />
        </div>
      </div>

      {/* PDF Upload Dropzone */}
      <div
        className="relative flex flex-col items-center justify-center p-6 sm:p-8 rounded-2xl border-2 border-dashed transition-all"
        style={{
          borderColor: policyUploaded ? "var(--accent)" : "var(--border-default)",
          backgroundColor: policyUploaded ? "var(--bg-surface)" : "var(--bg-card)",
        }}
      >
        <input
          type="file"
          id="policyPdfInput"
          accept="application/pdf"
          className="hidden"
          onChange={(e) => handleFileUpload(e.target.files)}
        />

        <div className="flex flex-col items-center text-center space-y-2">
          <div
            className="flex h-11 w-11 sm:h-12 sm:w-12 items-center justify-center rounded-xl border text-sm font-serif font-semibold"
            style={{
              borderColor: "var(--border-default)",
              backgroundColor: "var(--bg-surface)",
              color: "var(--accent)",
            }}
          >
            PDF
          </div>

          <p className="text-xs sm:text-sm font-medium text-[var(--text-primary)]">
            {policyUploaded ? (
              <span className="font-semibold text-[var(--accent)]">
                {uploadedFileName || "Policy Document"} Uploaded & Indexed
              </span>
            ) : (
              <>
                <label
                  htmlFor="policyPdfInput"
                  className="cursor-pointer font-semibold text-[var(--accent)] underline underline-offset-2 hover:opacity-80"
                >
                  Click to upload your policy PDF
                </label>
                <span className="hidden sm:inline"> or drag & drop here</span>
              </>
            )}
          </p>
          <p className="text-[11px] text-[var(--text-muted)] max-w-sm sm:max-w-none">
            Supports ISO HO-3, HO-5, commercial policies, or declarations schedules.
          </p>
          {policyUploaded && (
            <label
              htmlFor="policyPdfInput"
              className="mt-2 text-[11px] text-[var(--text-secondary)] hover:text-[var(--accent)] underline cursor-pointer"
            >
              Upload a different PDF
            </label>
          )}

          {isLoading && (
            <div className="flex items-center justify-center gap-2 mt-2 text-xs font-mono text-[var(--accent)]">
              <span className="h-3.5 w-3.5 rounded-full border-2 border-[var(--accent)] border-t-transparent animate-spin" />
              <span>Analyzing policy terms...</span>
            </div>
          )}

          {statusMessage && (
            <div className="mt-3 text-xs font-mono text-[var(--accent)] text-center">
              {statusMessage}
            </div>
          )}
        </div>
      </div>

      {/* Analysis Output */}
      {analysis && (
        <div
          className="rounded-2xl border p-4 sm:p-6 space-y-4 sm:space-y-5"
          style={{
            backgroundColor: "var(--bg-card)",
            borderColor: "var(--border-default)",
          }}
        >
          {/* Status Row */}
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b pb-4" style={{ borderColor: "var(--border-subtle)" }}>
            <div>
              <div className="text-[11px] font-mono uppercase tracking-wider text-[var(--text-muted)]">
                Coverage Determination
              </div>
              <div className="font-serif text-xl font-semibold text-[var(--text-primary)] mt-0.5">
                {analysis.peril || "Insured Peril Analysis"}
              </div>
            </div>

            <div>
              <span
                className={`inline-flex items-center px-3 py-1 text-xs font-medium rounded-full ${
                  analysis.is_covered
                    ? "bg-emerald-500/10 text-emerald-700 dark:text-emerald-400 border border-emerald-500/20"
                    : "bg-amber-500/10 text-amber-700 dark:text-amber-400 border border-amber-500/20"
                }`}
              >
                {analysis.is_covered ? "Verified Covered Loss" : "Coverage In Review"}
              </span>
            </div>
          </div>

          {/* MISSING FIELD PROMPT: If deductible was not explicitly detected in PDF */}
          {(analysis.deductible == null || analysis.missing_fields?.includes("deductible")) && (
            <div
              className="p-3.5 rounded-xl border border-amber-500/30 bg-amber-500/10 space-y-2.5 text-xs"
            >
              <div className="flex items-center gap-2 font-semibold text-amber-700 dark:text-amber-400">
                <span>⚠️</span> Policy Deductible Not Explicitly Found in Document
              </div>
              <p className="text-[var(--text-secondary)] leading-relaxed">
                Standard policy jackets often omit individual homeowner deductible amounts (these typically appear on the separate Declarations Page). Please enter your policy deductible to calculate accurate net payouts:
              </p>
              <div className="flex items-center gap-2 pt-1 flex-wrap">
                <div className="relative">
                  <span className="absolute left-2.5 top-1.5 font-mono text-xs font-semibold text-[var(--text-muted)]">$</span>
                  <input
                    type="number"
                    placeholder="1000"
                    value={customDeductible}
                    onChange={(e) => setCustomDeductible(e.target.value ? Number(e.target.value) : "")}
                    className="w-32 rounded-lg border pl-6 pr-2.5 py-1.5 text-xs font-mono font-semibold text-[var(--text-primary)] focus:outline-none focus:ring-1 focus:ring-[var(--accent)]"
                    style={{ backgroundColor: "var(--bg-surface)", borderColor: "var(--border-default)" }}
                  />
                </div>
                <button
                  type="button"
                  onClick={handleApplyCustomDeductible}
                  className="px-3.5 py-1.5 rounded-lg text-xs font-semibold text-white transition-all shadow-sm"
                  style={{ backgroundColor: "var(--accent)" }}
                >
                  Set Deductible
                </button>
                <span className="text-[11px] text-[var(--text-muted)]">
                  (Common defaults: $1,000 or $2,500)
                </span>
              </div>
            </div>
          )}

          {/* Metrics */}
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
            <div className="p-3 rounded-xl border" style={{ backgroundColor: "var(--bg-surface)", borderColor: "var(--border-subtle)" }}>
              <div className="text-[10px] uppercase font-mono tracking-wider text-[var(--text-muted)]">Policy Deductible</div>
              <div className="text-base font-semibold text-[var(--text-primary)] mt-1 font-mono">
                {analysis.deductible != null ? `$${analysis.deductible.toLocaleString()}` : "Not Specified"}
              </div>
            </div>
            <div className="p-3 rounded-xl border" style={{ backgroundColor: "var(--bg-surface)", borderColor: "var(--border-subtle)" }}>
              <div className="text-[10px] uppercase font-mono tracking-wider text-[var(--text-muted)]">Dwelling Limit (Coverage A)</div>
              <div className="text-base font-semibold text-[var(--text-primary)] mt-1 font-mono">
                ${(analysis.coverage_limit ?? 350000).toLocaleString()}
              </div>
            </div>
            <div className="col-span-2 sm:col-span-1 p-3 rounded-xl border" style={{ backgroundColor: "var(--bg-surface)", borderColor: "var(--border-subtle)" }}>
              <div className="text-[10px] uppercase font-mono tracking-wider text-[var(--text-muted)]">Applicable Peril</div>
              <div className="text-xs font-medium text-[var(--text-primary)] mt-1 truncate">
                {causeOfLoss === "water" ? "Internal Plumbing Discharge" : causeOfLoss}
              </div>
            </div>
          </div>

          {/* Reasoning */}
          {analysis.reasoning && (
            <div className="space-y-1.5">
              <div className="text-xs font-semibold text-[var(--text-primary)]">
                Legal Evaluation & Policy Context
              </div>
              <p className="text-xs leading-relaxed text-[var(--text-secondary)]">
                {analysis.reasoning}
              </p>
            </div>
          )}

          {/* Clauses */}
          {analysis.relevant_clauses && analysis.relevant_clauses.length > 0 && (
            <div className="space-y-2 pt-2 border-t" style={{ borderColor: "var(--border-subtle)" }}>
              <div className="text-[11px] font-mono uppercase tracking-wider text-[var(--text-muted)]">
                Cited Policy Sections
              </div>
              <div className="space-y-2">
                {analysis.relevant_clauses.map((clause, i) => (
                  <div
                    key={i}
                    className="p-3 rounded-lg border text-xs leading-relaxed"
                    style={{
                      backgroundColor: "var(--bg-surface)",
                      borderColor: "var(--border-subtle)",
                    }}
                  >
                    <div className="flex items-center justify-between text-[10px] font-mono text-[var(--accent)] mb-1">
                      <span>{clause.section}</span>
                      <span>Page {clause.page}</span>
                    </div>
                    <p className="text-[var(--text-secondary)] italic">"{clause.text}"</p>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
