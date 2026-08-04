/**
 * Formatting + rendering primitives shared by the report renderers
 * (`report/render.ts` for `opfor run`, `autonomous/report/html.ts` for `opfor hunt`).
 * Kept together so the two reports can't drift on escaping, number formatting, or severity colour.
 */

import type { Severity } from "../evaluators/schema.js";

/** Escape HTML special characters to prevent XSS in report output. */
export function esc(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/** Truncate a string to `n` characters, appending an ellipsis if clipped. */
export function truncate(s: string, n: number): string {
  return s.length > n ? s.slice(0, n) + "…" : s;
}

/** Format a token count for display (e.g. 51300 → "51.3K"). */
export function formatTokenCount(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return String(n);
}

/** Format a run duration for display (e.g. 754000 → "12m 34s"). */
export function formatDuration(ms: number): string {
  const totalSeconds = Math.round(ms / 1000);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  if (hours > 0) return `${hours}h ${minutes}m`;
  if (minutes > 0) return `${minutes}m ${seconds}s`;
  return `${seconds}s`;
}

/** Map a safety score (0–100) to a red/amber/green hex colour. */
export function safetyColor(score: number): string {
  if (score >= 70) return "#059669";
  if (score >= 50) return "#D97706";
  return "#DC2626";
}

export const SEV_HEX: Record<string, string> = {
  critical: "#DC2626",
  high: "#EA580C",
  medium: "#D97706",
  low: "#16A34A",
};

/** Worst-first, for ranking findings and picking a group's headline severity. */
export const SEV_ORDER: Severity[] = ["critical", "high", "medium", "low"];

/** Semi-circular SVG gauge for a 0-100 percentage score. */
export function gaugeSvg(pct: number, color: string): string {
  const r = 52;
  const circumference = Math.PI * r;
  const offset = circumference * (1 - Math.max(0, Math.min(100, pct)) / 100);
  return `<svg width="120" height="70" viewBox="0 0 120 70" style="display:block;margin:0">
    <path d="M8 64 A ${r} ${r} 0 0 1 112 64" fill="none" stroke="var(--line)" stroke-width="9" stroke-linecap="round"/>
    <path d="M8 64 A ${r} ${r} 0 0 1 112 64" fill="none" stroke="${color}" stroke-width="9" stroke-linecap="round"
      stroke-dasharray="${circumference.toFixed(2)}" stroke-dashoffset="${offset.toFixed(2)}"/>
  </svg>`;
}

/** Transcript role label row: icon + name. */
export function roleLabel(icon: string, name: string): string {
  return `<div class="turn-role"><span class="turn-icon">${icon}</span>${name}</div>`;
}
