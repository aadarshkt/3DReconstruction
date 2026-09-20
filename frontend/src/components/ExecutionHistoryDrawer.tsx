"use client";

import React, { useState, useEffect } from "react";

export interface ExecutionSummary {
  id: string;
  title: string;
  status: string;
  created_at?: string | null;
  updated_at?: string | null;
  job_id?: string | null;
  tier?: string | null;
  room_area_m2?: number | null;
  wall_count?: number | null;
  cause_of_loss?: string | null;
  property_type?: string | null;
  has_policy_pdf: boolean;
  policy_pdf_filename?: string | null;
  is_covered?: boolean | null;
  total_estimated_cost?: number | null;
  has_report_pdf: boolean;
  report_url?: string | null;
}

interface ExecutionHistoryDrawerProps {
  isOpen: boolean;
  onClose: () => void;
  activeExecutionId: string | null;
  onSelectExecution: (executionId: string) => void;
  onStartNewRun: () => void;
}

export default function ExecutionHistoryDrawer({
  isOpen,
  onClose,
  activeExecutionId,
  onSelectExecution,
  onStartNewRun,
}: ExecutionHistoryDrawerProps) {
  const [executions, setExecutions] = useState<ExecutionSummary[]>([]);
  const [loading, setLoading] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingTitle, setEditingTitle] = useState("");
  const [deletingId, setDeletingId] = useState<string | null>(null);

  const fetchExecutions = async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/v1/executions");
      if (res.ok) {
        const data = await res.json();
        setExecutions(data);
      }
    } catch (err) {
      console.error("Failed to load executions:", err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (isOpen) {
      fetchExecutions();
    }
  }, [isOpen]);

  const handleStartRename = (e: React.MouseEvent, item: ExecutionSummary) => {
    e.stopPropagation();
    setEditingId(item.id);
    setEditingTitle(item.title);
  };

  const handleSaveRename = async (e: React.MouseEvent, id: string) => {
    e.stopPropagation();
    if (!editingTitle.trim()) return;

    try {
      const res = await fetch(`/api/v1/executions/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title: editingTitle.trim() }),
      });
      if (res.ok) {
        setExecutions((prev) =>
          prev.map((ex) => (ex.id === id ? { ...ex, title: editingTitle.trim() } : ex))
        );
        setEditingId(null);
      }
    } catch (err) {
      console.error("Failed to rename execution:", err);
    }
  };

  const handleCancelRename = (e: React.MouseEvent) => {
    e.stopPropagation();
    setEditingId(null);
  };

  const handleDelete = async (e: React.MouseEvent, id: string) => {
    e.stopPropagation();
    try {
      const res = await fetch(`/api/v1/executions/${id}`, { method: "DELETE" });
      if (res.ok) {
        setExecutions((prev) => prev.filter((ex) => ex.id !== id));
        setDeletingId(null);
        if (activeExecutionId === id) {
          onStartNewRun();
        }
      }
    } catch (err) {
      console.error("Failed to delete execution:", err);
    }
  };

  if (!isOpen) return null;

  const filteredExecutions = executions.filter((ex) => {
    if (!searchQuery.trim()) return true;
    const q = searchQuery.toLowerCase();
    return (
      ex.title.toLowerCase().includes(q) ||
      (ex.cause_of_loss && ex.cause_of_loss.toLowerCase().includes(q)) ||
      (ex.tier && ex.tier.toLowerCase().includes(q)) ||
      ex.id.toLowerCase().includes(q)
    );
  });

  return (
    <div className="fixed inset-0 z-50 overflow-hidden">
      {/* Backdrop */}
      <div
        className="absolute inset-0 bg-black/60 backdrop-blur-sm transition-opacity"
        onClick={onClose}
      />

      <div className="fixed inset-y-0 right-0 max-w-full flex pl-10">
        <div
          className="w-screen max-w-xl flex flex-col border-l shadow-2xl transition-all"
          style={{
            backgroundColor: "var(--bg-card)",
            borderColor: "var(--border-subtle)",
          }}
        >
          {/* Top Header */}
          <div
            className="p-6 border-b flex items-start justify-between gap-4"
            style={{ borderColor: "var(--border-subtle)" }}
          >
            <div className="space-y-1">
              <div className="flex items-center gap-2">
                <span className="text-[11px] font-mono uppercase tracking-widest text-[var(--accent)] font-semibold">
                  Execution History
                </span>
                <span className="text-xs font-mono text-[var(--text-muted)]">
                  ({executions.length} saved)
                </span>
              </div>
              <h2 className="font-serif text-2xl font-medium tracking-tight text-[var(--text-primary)]">
                Past Reconstructions & Claims
              </h2>
              <p className="text-xs text-[var(--text-secondary)]">
                Access previously processed 3D point clouds, floor plans, policy analyses, and PDF reports.
              </p>
            </div>

            <button
              onClick={onClose}
              className="text-xs font-mono px-3 py-1.5 rounded-lg border border-[var(--border-subtle)] text-[var(--text-muted)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-surface)] transition-colors"
            >
              Close
            </button>
          </div>

          {/* Action Toolbar */}
          <div
            className="p-4 border-b flex flex-col sm:flex-row gap-3 items-stretch sm:items-center justify-between"
            style={{
              backgroundColor: "var(--bg-surface)",
              borderColor: "var(--border-subtle)",
            }}
          >
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search past runs by title, peril, or tier..."
              className="flex-1 text-xs px-3 py-2 rounded-lg border bg-[var(--bg-card)] text-[var(--text-primary)] focus:outline-none focus:ring-1 focus:ring-[var(--accent)] placeholder:text-[var(--text-muted)]"
              style={{ borderColor: "var(--border-default)" }}
            />

            <button
              onClick={() => {
                onStartNewRun();
                onClose();
              }}
              className="btn-squish px-4 py-2 text-xs font-semibold rounded-lg text-white transition-all text-center whitespace-nowrap"
              style={{ backgroundColor: "var(--accent)" }}
            >
              Start New Run
            </button>
          </div>

          {/* Execution List Content */}
          <div className="flex-1 overflow-y-auto p-4 sm:p-6 space-y-4">
            {loading && executions.length === 0 ? (
              <div className="py-16 text-center space-y-3">
                <span className="inline-block h-6 w-6 rounded-full border-2 border-[var(--accent)] border-t-transparent animate-spin" />
                <p className="text-xs font-mono text-[var(--text-muted)]">Loading saved runs...</p>
              </div>
            ) : filteredExecutions.length === 0 ? (
              <div className="py-16 text-center space-y-3 border border-dashed rounded-xl p-8" style={{ borderColor: "var(--border-subtle)" }}>
                <p className="text-sm font-medium text-[var(--text-primary)]">
                  {searchQuery ? "No matching executions found" : "No saved executions yet"}
                </p>
                <p className="text-xs text-[var(--text-secondary)] max-w-sm mx-auto">
                  {searchQuery
                    ? "Try adjusting your search terms."
                    : "Upload room footage or process an insurance claim to automatically preserve your 3D spatial reconstructions and reports."}
                </p>
                {!searchQuery && (
                  <button
                    onClick={() => {
                      onStartNewRun();
                      onClose();
                    }}
                    className="mt-2 text-xs font-semibold px-4 py-2 rounded-lg text-white"
                    style={{ backgroundColor: "var(--accent)" }}
                  >
                    Start New Run
                  </button>
                )}
              </div>
            ) : (
              filteredExecutions.map((item) => {
                const isActive = item.id === activeExecutionId;
                const formattedDate = item.created_at
                  ? new Date(item.created_at).toLocaleDateString(undefined, {
                      month: "short",
                      day: "numeric",
                      year: "numeric",
                      hour: "2-digit",
                      minute: "2-digit",
                    })
                  : "Date unavailable";

                return (
                  <div
                    key={item.id}
                    onClick={() => {
                      onSelectExecution(item.id);
                      onClose();
                    }}
                    className={`group cursor-pointer rounded-xl border p-4 sm:p-5 transition-all space-y-3 ${
                      isActive
                        ? "border-[var(--accent)] ring-1 ring-[var(--accent)]"
                        : "hover:border-[var(--border-strong)]"
                    }`}
                    style={{
                      backgroundColor: isActive ? "var(--bg-surface)" : "var(--bg-card)",
                      borderColor: isActive ? "var(--accent)" : "var(--border-default)",
                      boxShadow: "var(--shadow-card)",
                    }}
                  >
                    {/* Header: Title and Status */}
                    <div className="flex items-start justify-between gap-3">
                      <div className="space-y-1 flex-1 min-w-0">
                        {editingId === item.id ? (
                          <div className="flex items-center gap-2" onClick={(e) => e.stopPropagation()}>
                            <input
                              type="text"
                              value={editingTitle}
                              onChange={(e) => setEditingTitle(e.target.value)}
                              className="text-xs px-2 py-1 rounded border bg-[var(--bg-card)] text-[var(--text-primary)] w-full focus:outline-none focus:ring-1 focus:ring-[var(--accent)]"
                              style={{ borderColor: "var(--border-default)" }}
                              autoFocus
                            />
                            <button
                              onClick={(e) => handleSaveRename(e, item.id)}
                              className="text-[11px] font-mono px-2 py-1 rounded bg-[var(--accent)] text-white font-semibold"
                            >
                              Save
                            </button>
                            <button
                              onClick={handleCancelRename}
                              className="text-[11px] font-mono px-2 py-1 rounded border border-[var(--border-subtle)] text-[var(--text-muted)]"
                            >
                              Cancel
                            </button>
                          </div>
                        ) : (
                          <div className="flex items-baseline gap-2 flex-wrap">
                            <h3 className="font-serif text-base font-semibold text-[var(--text-primary)] truncate">
                              {item.title}
                            </h3>
                            <button
                              onClick={(e) => handleStartRename(e, item)}
                              className="text-[10px] font-mono text-[var(--text-muted)] hover:text-[var(--text-primary)] underline cursor-pointer"
                              title="Rename execution"
                            >
                              Rename
                            </button>
                          </div>
                        )}

                        <div className="flex items-center gap-2 text-[11px] font-mono text-[var(--text-muted)] flex-wrap">
                          <span>{formattedDate}</span>
                          <span>·</span>
                          <span className="uppercase">{item.tier || "3D Scan"}</span>
                          <span>·</span>
                          <span className="text-[10px] text-[var(--text-secondary)]">{item.id.slice(0, 8)}</span>
                        </div>
                      </div>

                      {/* State Badges */}
                      <div className="flex flex-col items-end gap-1 shrink-0">
                        {isActive && (
                          <span className="text-[10px] font-mono uppercase px-2 py-0.5 rounded font-semibold bg-[var(--accent-subtle)] text-[var(--accent)] border border-[var(--accent)]">
                            Active Run
                          </span>
                        )}
                        <span className="text-[10px] font-mono uppercase px-2 py-0.5 rounded text-[var(--text-muted)] bg-[var(--bg-surface)] border border-[var(--border-subtle)]">
                          {item.status}
                        </span>
                      </div>
                    </div>

                    {/* Key Metrics Strip */}
                    <div
                      className="grid grid-cols-3 gap-2 p-2.5 rounded-lg border text-center font-mono text-xs"
                      style={{
                        backgroundColor: "var(--bg-surface)",
                        borderColor: "var(--border-subtle)",
                      }}
                    >
                      <div>
                        <div className="text-[10px] uppercase text-[var(--text-muted)]">Room Area</div>
                        <div className="font-semibold text-[var(--text-primary)]">
                          {item.room_area_m2 ? `${item.room_area_m2.toFixed(1)} m²` : "--"}
                        </div>
                      </div>
                      <div>
                        <div className="text-[10px] uppercase text-[var(--text-muted)]">Net Payout</div>
                        <div className="font-semibold text-[var(--text-primary)]">
                          {item.total_estimated_cost
                            ? `$${item.total_estimated_cost.toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`
                            : "--"}
                        </div>
                      </div>
                      <div>
                        <div className="text-[10px] uppercase text-[var(--text-muted)]">Cause</div>
                        <div className="font-semibold text-[var(--text-primary)] capitalize">
                          {item.cause_of_loss || "Damage"}
                        </div>
                      </div>
                    </div>

                    {/* Content Availability Indicators (Pure text, no icons) */}
                    <div className="flex items-center gap-1.5 flex-wrap text-[10px] font-mono text-[var(--text-secondary)]">
                      {item.room_area_m2 != null && (
                        <span className="px-1.5 py-0.5 rounded border border-[var(--border-subtle)] bg-[var(--bg-surface)]">
                          [3D Geometry Ready]
                        </span>
                      )}
                      {item.has_policy_pdf && (
                        <span className="px-1.5 py-0.5 rounded border border-[var(--border-subtle)] bg-[var(--bg-surface)]">
                          [Policy Document]
                        </span>
                      )}
                      {item.total_estimated_cost != null && (
                        <span className="px-1.5 py-0.5 rounded border border-[var(--border-subtle)] bg-[var(--bg-surface)]">
                          [Cost Schedule]
                        </span>
                      )}
                      {item.has_report_pdf && (
                        <span className="px-1.5 py-0.5 rounded border border-[var(--border-subtle)] bg-[var(--bg-surface)]">
                          [PDF Report Available]
                        </span>
                      )}
                    </div>

                    {/* Action Buttons */}
                    <div
                      className="pt-2 border-t flex items-center justify-between gap-2"
                      style={{ borderColor: "var(--border-subtle)" }}
                    >
                      <div className="flex items-center gap-2">
                        <button
                          onClick={() => {
                            onSelectExecution(item.id);
                            onClose();
                          }}
                          className={`text-xs font-semibold px-3 py-1.5 rounded-lg transition-colors ${
                            isActive
                              ? "bg-[var(--accent)] text-white"
                              : "border border-[var(--border-default)] text-[var(--text-primary)] hover:bg-[var(--bg-surface)]"
                          }`}
                        >
                          {isActive ? "Active in Console" : "Load Run"}
                        </button>

                        <a
                          href={`/api/v1/executions/${item.id}/pdf`}
                          download
                          onClick={(e) => e.stopPropagation()}
                          className="text-xs font-mono px-3 py-1.5 rounded-lg border border-[var(--border-default)] text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-surface)] transition-colors"
                        >
                          Download PDF Report
                        </a>
                      </div>

                      {deletingId === item.id ? (
                        <div className="flex items-center gap-1.5" onClick={(e) => e.stopPropagation()}>
                          <button
                            onClick={(e) => handleDelete(e, item.id)}
                            className="text-[11px] font-mono px-2 py-1 rounded bg-red-600 text-white font-semibold"
                          >
                            Confirm
                          </button>
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              setDeletingId(null);
                            }}
                            className="text-[11px] font-mono px-2 py-1 rounded border border-[var(--border-subtle)] text-[var(--text-muted)]"
                          >
                            Cancel
                          </button>
                        </div>
                      ) : (
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            setDeletingId(item.id);
                          }}
                          className="text-[11px] font-mono text-[var(--text-muted)] hover:text-red-500 transition-colors"
                          title="Delete execution"
                        >
                          Delete
                        </button>
                      )}
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
