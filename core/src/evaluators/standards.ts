/**
 * Helpers for evaluator `standards` frontmatter (taxonomy → ID).
 */
import type { StandardsMap } from "./schema.js";

/** Infer taxonomy key from a standard ID string (e.g. LLM07 → owasp-llm). */
export function inferStandardsKey(id: string): string {
  const code = id.trim().toUpperCase();
  if (/^LLM\d+/.test(code)) return "owasp-llm";
  if (/^MCP\d+/.test(code)) return "owasp-mcp";
  if (/^ASI\d+/.test(code)) return "owasp-agentic";
  if (/^API\d+/.test(code)) return "owasp-api";
  if (/^AML\.T\d+/.test(code)) return "atlas";
  return "standard";
}

/** One-line label for prompts and reports: `owasp-llm: LLM07, atlas: AML.T0056`. */
export function formatStandardsLabel(standards?: StandardsMap): string {
  if (!standards || Object.keys(standards).length === 0) return "";
  return Object.entries(standards)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([k, v]) => `${k}: ${v}`)
    .join(", ");
}

/** `standards` map from frontmatter (no `ref` / `mitre` — those are rejected by validate-skills). */
export function resolveStandardsFromFrontmatter(
  doc: Record<string, unknown>
): StandardsMap | undefined {
  return parseStandardsField(doc) ?? undefined;
}

/** Parse `standards` object from raw YAML frontmatter. */
export function parseStandardsField(doc: Record<string, unknown>): StandardsMap | null {
  const raw = doc.standards;
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const out: StandardsMap = {};
  for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
    if (typeof k === "string" && k.trim() && typeof v === "string" && v.trim()) {
      out[k.trim()] = v.trim();
    }
  }
  return Object.keys(out).length > 0 ? out : null;
}
