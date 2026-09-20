"use client";

import React, { useState, useEffect, useRef } from "react";
import Link from "next/link";
import PointcloudViewer from "./PointcloudViewer";

interface ChatMessage {
  id: string;
  sender: "user" | "assistant";
  text: string;
  intent?: string;
  source?: string;
}

export default function ConsolePreview() {
  const [viewMode, setViewMode] = useState<"3d" | "2d">("3d");
  const [messages, setMessages] = useState<ChatMessage[]>([
    {
      id: "1",
      sender: "user",
      text: "A pressurized copper pipe burst under the kitchen sink causing water damage. Does my ISO HO-3 policy cover this?",
    },
    {
      id: "2",
      sender: "assistant",
      text: "Fully Covered Loss. Under Section I – Peril 12 (Accidental Discharge of Water), tear-out and repair are covered under Coverage A (Dwelling). The continuous seepage exclusion does not apply.",
      intent: "COVERAGE: VERIFIED",
      source: "ISO HO-3 Policy · Page 9",
    },
    {
      id: "3",
      sender: "user",
      text: "What are the exact scan dimensions and estimated net payout?",
    },
    {
      id: "4",
      sender: "assistant",
      text: "From your 24.5 m² scan: 5.40m × 4.50m room with 18.2 m² saturation zone. Gross estimate is $5,101.47 minus your $1,000 deductible = $4,101.47 net payout.",
      intent: "COST & GEOMETRY",
      source: "RoomPlan LiDAR + Xactimate",
    },
  ]);
  const [inputQuery, setInputQuery] = useState("");
  const [isTyping, setIsTyping] = useState(false);
  const chatContainerRef = useRef<HTMLDivElement>(null);
  const isInitialMount = useRef(true);

  const quickPrompts = [
    { label: "Is pipe burst covered?", q: "Is sudden water damage from a burst copper line covered under my policy?" },
    { label: "Room dimensions", q: "What are the exact room dimensions and wall lengths from the 3D LiDAR scan?" },
    { label: "Deductible calculation", q: "How is my $1,000 deductible applied against the gross repair estimate?" },
  ];

  const handleSend = async (queryText?: string) => {
    const text = (queryText || inputQuery).trim();
    if (!text) return;

    const userMsg: ChatMessage = {
      id: `u-${Date.now()}`,
      sender: "user",
      text,
    };
    setMessages((prev) => [...prev, userMsg]);
    setInputQuery("");
    setIsTyping(true);

    try {
      const res = await fetch("/api/v1/tour/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: text }),
      });
      if (res.ok) {
        const data = await res.json();
        const reply = data.reply || data.response || data.text;
        setMessages((prev) => [
          ...prev,
          {
            id: `a-${Date.now()}`,
            sender: "assistant",
            text: reply,
            intent: (data.intent || "ASSISTANT").toUpperCase().replace("_", " "),
            source: data.source || "ClaimSpace Knowledge Base",
          },
        ]);
        setIsTyping(false);
        return;
      }
      throw new Error("Chat endpoint status " + res.status);
    } catch {
      setTimeout(() => {
        let reply = "";
        let intent = "POLICY INFO";
        let source = "ISO HO-3 Standard";
        const q = text.toLowerCase();
        if (q.includes("cover") || q.includes("water") || q.includes("pipe") || q.includes("leak")) {
          intent = "COVERAGE VERIFIED";
          source = "ISO HO-3 Section I (Page 9)";
          reply =
            "Fully Covered Loss. Sudden plumbing discharge is covered under Peril 12. Net payout is calculated at $4,101.47 after applying your $1,000 deductible.";
        } else if (q.includes("cost") || q.includes("payout") || q.includes("deductible")) {
          intent = "ESTIMATE SCOPE";
          source = "Xactimate Pricing Matrix";
          reply =
            "Gross repair scope: $5,101.47 (includes 10% contractor O&P). Subtracting the $1,000 deductible yields $4,101.47 net claim payout.";
        } else {
          intent = "ROOM GEOMETRY";
          source = "LiDAR Spatial Model";
          reply =
            "Reconstructed dimensions: 5.40m × 4.50m (24.5 m² total area). Saturated water damage zone covers 18.2 m² across 4 wall segments.";
        }
        setMessages((prev) => [
          ...prev,
          {
            id: `a-${Date.now()}`,
            sender: "assistant",
            text: reply,
            intent,
            source,
          },
        ]);
        setIsTyping(false);
      }, 500);
    }
  };

  useEffect(() => {
    if (isInitialMount.current) {
      isInitialMount.current = false;
      return;
    }
    if (chatContainerRef.current) {
      chatContainerRef.current.scrollTo({
        top: chatContainerRef.current.scrollHeight,
        behavior: "smooth",
      });
    }
  }, [messages, isTyping]);

  return (
    <div className="space-y-16 sm:space-y-24">
      
      {/* ============================================================
          VERTICAL CHAPTER 1: Interactive 3D Spatial Reconstruction
      ============================================================ */}
      <div className="space-y-6">
        <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-4">
          <div className="space-y-1.5 max-w-2xl">
            <span className="text-xs font-mono uppercase tracking-widest text-[var(--accent)] font-semibold">
              01 / Spatial Reconstruction
            </span>
            <h3 className="font-serif text-2xl sm:text-3xl font-medium tracking-tight text-[var(--text-primary)]">
              Direct 3D Point Cloud &amp; Floor Plan Extraction
            </h3>
            <p className="text-xs sm:text-sm text-[var(--text-secondary)] leading-relaxed">
              Drag on the canvas to rotate the dense 3D point cloud model, or toggle to the dimensioned 2D architectural blueprint.
            </p>
          </div>

          {/* View Mode Switcher */}
          <div className="inline-flex rounded-xl border p-1 text-xs font-mono self-start sm:self-auto shrink-0" style={{ backgroundColor: "var(--bg-surface)", borderColor: "var(--border-subtle)" }}>
            <button
              onClick={() => setViewMode("3d")}
              className={`btn-squish px-3.5 py-1.5 rounded-lg transition-all ${
                viewMode === "3d"
                  ? "bg-[var(--bg-card)] text-[var(--text-primary)] font-semibold shadow-xs border border-[var(--border-default)]"
                  : "text-[var(--text-muted)] hover:text-[var(--text-primary)]"
              }`}
            >
              3D Point Cloud
            </button>
            <button
              onClick={() => setViewMode("2d")}
              className={`btn-squish px-3.5 py-1.5 rounded-lg transition-all ${
                viewMode === "2d"
                  ? "bg-[var(--bg-card)] text-[var(--text-primary)] font-semibold shadow-xs border border-[var(--border-default)]"
                  : "text-[var(--text-muted)] hover:text-[var(--text-primary)]"
              }`}
            >
              2D Floor Plan
            </button>
          </div>
        </div>

        {/* Generous High-Impact 3D Canvas Box */}
        <div
          className="rounded-2xl border p-3 sm:p-5 shadow-sm space-y-4"
          style={{
            backgroundColor: "var(--bg-card)",
            borderColor: "var(--border-default)",
          }}
        >
          {viewMode === "3d" ? (
            <PointcloudViewer
              plyUrl="/api/v1/tour/artifacts/point_cloud.ply"
              hasScan={true}
              heightClass="h-[380px] sm:h-[460px]"
            />
          ) : (
            <div className="relative w-full h-[380px] sm:h-[460px] rounded-xl overflow-hidden border border-[var(--border-subtle)] bg-[#181716] flex items-center justify-center p-4">
              <svg viewBox="0 0 680 520" className="w-full h-full max-h-[420px]">
                <defs>
                  <pattern id="vertGrid" width="30" height="30" patternUnits="userSpaceOnUse">
                    <path d="M 30 0 L 0 0 0 30" fill="none" stroke="#2a2723" strokeWidth="0.8" />
                  </pattern>
                </defs>
                <rect width="100%" height="100%" fill="url(#vertGrid)" />

                {/* Room Polygon */}
                <polygon points="120,70 560,70 560,430 120,430" fill="#22201d" fillOpacity="0.85" />

                {/* Water Damage Zone */}
                <rect x="160" y="110" width="360" height="280" rx="8" fill="#c96442" fillOpacity="0.18" stroke="#c96442" strokeWidth="1.75" strokeDasharray="5,4" />
                <text x="340" y="240" fill="#e28362" fontFamily="sans-serif" fontSize="14" fontWeight="700" textAnchor="middle">
                  Saturated Water Zone (18.2 m²)
                </text>
                <text x="340" y="265" fill="#a6a097" fontFamily="sans-serif" fontSize="11" textAnchor="middle">
                  Subfloor &amp; baseboard moisture saturation
                </text>

                {/* Walls */}
                <line x1="120" y1="70" x2="560" y2="70" stroke="#f8fafc" strokeWidth="6" strokeLinecap="round" />
                <text x="340" y="55" fill="#e28362" fontFamily="sans-serif" fontSize="12" fontWeight="700" textAnchor="middle">WALL 1: 5.40 m</text>

                <line x1="560" y1="70" x2="560" y2="430" stroke="#f8fafc" strokeWidth="6" strokeLinecap="round" />
                <text x="585" y="255" fill="#e28362" fontFamily="sans-serif" fontSize="12" fontWeight="700">4.50 m</text>

                <line x1="560" y1="430" x2="120" y2="430" stroke="#f8fafc" strokeWidth="6" strokeLinecap="round" />
                <text x="340" y="455" fill="#e28362" fontFamily="sans-serif" fontSize="12" fontWeight="700" textAnchor="middle">WALL 3: 5.40 m</text>

                <line x1="120" y1="430" x2="120" y2="70" stroke="#f8fafc" strokeWidth="6" strokeLinecap="round" />
                <text x="65" y="255" fill="#e28362" fontFamily="sans-serif" fontSize="12" fontWeight="700">4.50 m</text>
              </svg>
            </div>
          )}

          {/* Minimalist Data Strip */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 pt-1">
            <div className="p-3 rounded-xl border text-center" style={{ backgroundColor: "var(--bg-surface)", borderColor: "var(--border-subtle)" }}>
              <div className="text-[10px] font-mono text-[var(--text-muted)] uppercase">Total Room Area</div>
              <div className="text-sm sm:text-base font-semibold text-[var(--text-primary)] font-mono mt-0.5">24.5 m²</div>
            </div>
            <div className="p-3 rounded-xl border text-center" style={{ backgroundColor: "var(--bg-surface)", borderColor: "var(--border-subtle)" }}>
              <div className="text-[10px] font-mono text-[var(--text-muted)] uppercase">Damage Footprint</div>
              <div className="text-sm sm:text-base font-semibold text-[var(--accent)] font-mono mt-0.5">18.2 m²</div>
            </div>
            <div className="p-3 rounded-xl border text-center" style={{ backgroundColor: "var(--bg-surface)", borderColor: "var(--border-subtle)" }}>
              <div className="text-[10px] font-mono text-[var(--text-muted)] uppercase">LiDAR Precision</div>
              <div className="text-sm sm:text-base font-semibold text-[var(--text-primary)] font-mono mt-0.5">±0.8 cm</div>
            </div>
            <div className="p-3 rounded-xl border text-center" style={{ backgroundColor: "var(--bg-surface)", borderColor: "var(--border-subtle)" }}>
              <div className="text-[10px] font-mono text-[var(--text-muted)] uppercase">Wall Segments</div>
              <div className="text-sm sm:text-base font-semibold text-[var(--text-primary)] font-mono mt-0.5">4 Segments</div>
            </div>
          </div>
        </div>
      </div>

      {/* ============================================================
          VERTICAL CHAPTER 2: Conversational AI & Policy Verification
      ============================================================ */}
      <div className="space-y-6">
        <div className="space-y-1.5 max-w-2xl">
          <span className="text-xs font-mono uppercase tracking-widest text-[var(--accent)] font-semibold">
            02 / Policy Intelligence &amp; AI QA
          </span>
          <h3 className="font-serif text-2xl sm:text-3xl font-medium tracking-tight text-[var(--text-primary)]">
            Natural Language Policy Matching &amp; Retrieval
          </h3>
          <p className="text-xs sm:text-sm text-[var(--text-secondary)] leading-relaxed">
            Correlate physical damage directly with policy contract provisions. Test the conversational assistant below.
          </p>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-stretch">
          
          {/* Left: Policy Document Clause Snippet (5 cols) */}
          <div
            className="lg:col-span-5 rounded-2xl border p-5 flex flex-col justify-between space-y-4 shadow-sm"
            style={{
              backgroundColor: "var(--bg-card)",
              borderColor: "var(--border-default)",
            }}
          >
            <div className="space-y-4">
              <div className="flex items-center justify-between border-b pb-3" style={{ borderColor: "var(--border-subtle)" }}>
                <div>
                  <span className="text-xs font-mono font-semibold text-[var(--accent)] uppercase">ISO HO-3 Policy</span>
                  <div className="text-xs text-[var(--text-muted)] font-mono">Form HO3-8829104-NY</div>
                </div>
                <span className="px-2.5 py-1 rounded-full text-[11px] font-mono border border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-400 font-semibold">
                  100% Covered
                </span>
              </div>

              <div className="p-4 rounded-xl border space-y-2" style={{ backgroundColor: "var(--bg-surface)", borderColor: "var(--border-subtle)" }}>
                <span className="text-xs font-semibold text-[var(--text-primary)]">
                  Section I – Perils Insured Against (Page 9)
                </span>
                <p className="text-xs text-[var(--text-secondary)] italic leading-relaxed">
                  &ldquo;12. Accidental Discharge Or Overflow Of Water Or Steam from within a plumbing system... We cover the cost of tearing out and replacing any part of the building necessary to repair the system.&rdquo;
                </p>
              </div>

              <div className="space-y-2 text-xs">
                <div className="flex items-center justify-between py-1 border-b" style={{ borderColor: "var(--border-subtle)" }}>
                  <span className="text-[var(--text-muted)]">Coverage A Limit</span>
                  <span className="font-mono font-medium text-[var(--text-primary)]">$350,000.00</span>
                </div>
                <div className="flex items-center justify-between py-1 border-b" style={{ borderColor: "var(--border-subtle)" }}>
                  <span className="text-[var(--text-muted)]">Policy Deductible</span>
                  <span className="font-mono font-semibold text-[var(--accent)]">$1,000.00</span>
                </div>
                <div className="flex items-center justify-between py-1">
                  <span className="text-[var(--text-muted)]">Seepage Exclusion</span>
                  <span className="text-emerald-600 dark:text-emerald-400 font-medium">Dismissed (Sudden Failure)</span>
                </div>
              </div>
            </div>

            <div className="pt-3 border-t flex items-center justify-between text-xs" style={{ borderColor: "var(--border-subtle)" }}>
              <span className="text-[var(--text-muted)]">Full document index ready</span>
              <Link href="/portal?tab=policy" className="font-semibold text-[var(--accent)] hover:underline inline-flex items-center gap-1">
                <span>View Full Policy</span>
                <span>→</span>
              </Link>
            </div>
          </div>

          {/* Right: Live Chat Window (7 cols, generous height) */}
          <div
            className="lg:col-span-7 rounded-2xl border p-5 flex flex-col justify-between shadow-sm min-h-[440px]"
            style={{
              backgroundColor: "var(--bg-card)",
              borderColor: "var(--border-default)",
            }}
          >
            {/* Header */}
            <div className="flex items-center justify-between border-b pb-3" style={{ borderColor: "var(--border-subtle)" }}>
              <div className="flex items-center gap-2.5">
                <div className="w-7 h-7 rounded-lg flex items-center justify-center font-serif text-xs font-bold text-white bg-[var(--accent)]">
                  AI
                </div>
                <div>
                  <div className="text-xs font-semibold text-[var(--text-primary)] flex items-center gap-1.5">
                    <span>Claim Intelligence Assistant</span>
                    <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 inline-block" />
                  </div>
                  <div className="text-[10px] font-mono text-[var(--text-muted)]">
                    Legal RAG · Spatial Dimensions · Deterministic Rates
                  </div>
                </div>
              </div>

              <span className="text-[10px] font-mono px-2 py-0.5 rounded border border-[var(--border-subtle)] bg-[var(--bg-surface)] text-[var(--text-secondary)]">
                Live Interactive
              </span>
            </div>

            {/* Chat Stream */}
            <div ref={chatContainerRef} className="flex-1 overflow-y-auto max-h-[290px] my-3 pr-1 space-y-3">
              {messages.map((m) => {
                const isUser = m.sender === "user";
                return (
                  <div key={m.id} className={`flex flex-col ${isUser ? "items-end" : "items-start"}`}>
                    <span className="text-[9px] font-mono text-[var(--text-muted)] mb-0.5 px-1">
                      {isUser ? "Homeowner" : "ClaimSpace AI"}
                    </span>
                    <div
                      className={`max-w-[88%] rounded-2xl p-3 text-xs leading-relaxed ${
                        isUser
                          ? "rounded-br-none text-white bg-[var(--accent)]"
                          : "rounded-bl-none border text-[var(--text-primary)] bg-[var(--bg-surface)] border-[var(--border-subtle)]"
                      }`}
                    >
                      {!isUser && m.intent && (
                        <div className="text-[9px] font-mono font-bold text-[var(--accent)] mb-1 uppercase">
                          [{m.intent}]
                        </div>
                      )}
                      <div className="whitespace-pre-line">{m.text}</div>
                    </div>
                  </div>
                );
              })}

              {isTyping && (
                <div className="flex items-center gap-1 p-2 rounded-lg border w-16 bg-[var(--bg-surface)] border-[var(--border-subtle)]">
                  <span className="w-1.5 h-1.5 rounded-full bg-[var(--accent)] animate-bounce" />
                  <span className="w-1.5 h-1.5 rounded-full bg-[var(--accent)] animate-bounce [animation-delay:0.2s]" />
                  <span className="w-1.5 h-1.5 rounded-full bg-[var(--accent)] animate-bounce [animation-delay:0.4s]" />
                </div>
              )}
            </div>

            {/* Quick Prompt Chips */}
            <div className="flex items-center gap-2 overflow-x-auto no-scrollbar py-2 border-t" style={{ borderColor: "var(--border-subtle)" }}>
              <span className="text-[10px] font-mono text-[var(--text-muted)] uppercase shrink-0">Try asking:</span>
              {quickPrompts.map((p, idx) => (
                <button
                  key={idx}
                  onClick={() => handleSend(p.q)}
                  className="btn-squish shrink-0 text-[11px] px-2.5 py-1 rounded-full border text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:border-[var(--accent)] bg-[var(--bg-surface)] transition-all"
                  style={{ borderColor: "var(--border-subtle)" }}
                >
                  {p.label}
                </button>
              ))}
            </div>

            {/* Input Bar */}
            <form
              onSubmit={(e) => {
                e.preventDefault();
                handleSend();
              }}
              className="flex items-center gap-2 pt-2"
            >
              <input
                type="text"
                value={inputQuery}
                onChange={(e) => setInputQuery(e.target.value)}
                placeholder="Ask about policy, scan measurements, repair costs..."
                className="flex-1 text-xs px-3.5 py-2 rounded-xl border bg-[var(--bg-surface)] text-[var(--text-primary)] placeholder-[var(--text-muted)] focus:outline-none focus:ring-1 focus:ring-[var(--accent)]"
                style={{ borderColor: "var(--border-default)" }}
              />
              <button
                type="submit"
                disabled={!inputQuery.trim() || isTyping}
                className="btn-squish px-3.5 py-2 text-xs font-semibold rounded-xl text-white disabled:opacity-40 transition-all"
                style={{ backgroundColor: "var(--accent)" }}
              >
                Send
              </button>
            </form>
          </div>
        </div>
      </div>

      {/* ============================================================
          VERTICAL CHAPTER 3: Minimalist Repair Calculation & Payout
      ============================================================ */}
      <div className="space-y-6">
        <div className="space-y-1.5 max-w-2xl">
          <span className="text-xs font-mono uppercase tracking-widest text-[var(--accent)] font-semibold">
            03 / Deterministic Cost Engine
          </span>
          <h3 className="font-serif text-2xl sm:text-3xl font-medium tracking-tight text-[var(--text-primary)]">
            Standardized Repair Scope &amp; Instant Payout
          </h3>
          <p className="text-xs sm:text-sm text-[var(--text-secondary)] leading-relaxed">
            Physical 3D dimensions link directly into certified contractor rate tables with transparent deductible deductions.
          </p>
        </div>

        <div
          className="rounded-2xl border p-5 sm:p-7 space-y-6 shadow-sm"
          style={{
            backgroundColor: "var(--bg-card)",
            borderColor: "var(--border-default)",
          }}
        >
          {/* 3 Prominent KPI Pillars */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <div className="p-4 rounded-xl border" style={{ backgroundColor: "var(--bg-surface)", borderColor: "var(--border-subtle)" }}>
              <div className="text-[10px] font-mono text-[var(--text-muted)] uppercase tracking-wider">Gross Repair Scope</div>
              <div className="font-serif text-2xl sm:text-3xl font-semibold text-[var(--text-primary)] mt-1">$5,101.47</div>
              <div className="text-xs text-[var(--text-secondary)] mt-1">Direct construction + 10% O&amp;P</div>
            </div>

            <div className="p-4 rounded-xl border" style={{ backgroundColor: "var(--bg-surface)", borderColor: "var(--border-subtle)" }}>
              <div className="text-[10px] font-mono text-[var(--text-muted)] uppercase tracking-wider">Policy Deductible</div>
              <div className="font-serif text-2xl sm:text-3xl font-semibold text-[var(--text-secondary)] mt-1">-$1,000.00</div>
              <div className="text-xs text-[var(--text-secondary)] mt-1">Applied per ISO HO-3 terms</div>
            </div>

            <div className="p-4 rounded-xl border" style={{ backgroundColor: "var(--bg-card)", borderColor: "var(--accent)", boxShadow: "0 0 16px var(--accent-subtle)" }}>
              <div className="text-[10px] font-mono text-[var(--accent)] font-semibold uppercase tracking-wider">Net Claim Payout</div>
              <div className="font-serif text-2xl sm:text-3xl font-bold text-[var(--accent)] mt-1">$4,101.47</div>
              <div className="text-xs font-medium text-[var(--text-primary)] mt-1">Ready for carrier payout</div>
            </div>
          </div>

          {/* Clean Line Items Schedule */}
          <div className="rounded-xl border overflow-hidden" style={{ borderColor: "var(--border-subtle)" }}>
            <div className="px-4 py-3 border-b text-xs font-semibold text-[var(--text-primary)] flex items-center justify-between" style={{ backgroundColor: "var(--bg-surface)", borderColor: "var(--border-subtle)" }}>
              <span>Primary Reconstruction Line Items</span>
              <span className="font-mono text-[11px] text-[var(--text-muted)]">Derived from 24.5 m² Scan</span>
            </div>

            <div className="divide-y text-xs" style={{ borderColor: "var(--border-subtle)" }}>
              {[
                { code: "WTR-EXT", title: "Emergency standing water extraction from subfloor & tile", qty: "18.2 m²", rate: "$28.50/m²", total: "$518.70" },
                { code: "DRY-TEAR", title: "Tear out & bag saturated 1/2\" drywall 2ft flood cut", qty: "14.4 m²", rate: "$42.00/m²", total: "$604.80" },
                { code: "DRY-INST", title: "Hang, tape, float & sand water-resistant mold drywall", qty: "14.4 m²", rate: "$68.00/m²", total: "$979.20" },
                { code: "FLR-INST", title: "Engineered hardwood underlayment & plank replacement", qty: "18.2 m²", rate: "$75.00/m²", total: "$1,365.00" },
                { code: "FLR-SUB", title: "Antimicrobial treatment & commercial dehumidification (3 days)", qty: "3 days", rate: "$210.00/day", total: "$630.00" },
              ].map((item, idx) => (
                <div key={idx} className="px-4 py-3 flex items-center justify-between gap-3">
                  <div className="flex items-center gap-2.5">
                    <span className="font-mono text-[10px] text-[var(--text-muted)] px-1.5 py-0.5 rounded border border-[var(--border-subtle)] bg-[var(--bg-surface)]">
                      {item.code}
                    </span>
                    <span className="text-[var(--text-primary)] font-medium">{item.title}</span>
                  </div>
                  <div className="flex items-center gap-4 font-mono text-right shrink-0">
                    <span className="hidden sm:inline text-[var(--text-muted)] text-[11px]">{item.qty} · {item.rate}</span>
                    <span className="font-semibold text-[var(--text-primary)] w-20">{item.total}</span>
                  </div>
                </div>
              ))}
            </div>

            <div className="px-4 py-3 border-t flex flex-wrap items-center justify-between gap-2 text-xs font-mono" style={{ backgroundColor: "var(--bg-surface)", borderColor: "var(--border-subtle)" }}>
              <span className="text-[var(--text-secondary)]">Direct Construction: $4,637.70 + 10% Contractor O&amp;P ($463.77)</span>
              <span className="text-[var(--accent)] font-semibold">Pricing Standard: Xactimate Regional Matrix 2025.Q1</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
