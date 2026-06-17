// Render a compact digest of the seed knowledge for prompt injection.

import type { KnowledgeBase } from "../knowledge/types.js";

export function renderKnowledgeDigest(kb: KnowledgeBase): string {
  const vulns = kb.vulnClasses
    .map((v) => `  - ${v.id} (${v.severity}): ${v.name} — ${v.description.replace(/\s+/g, " ")}`)
    .join("\n");
  const personas = kb.personas.map((p) => `  - ${p.id}: ${p.name} — ${p.whenToUse}`).join("\n");
  const strategies = kb.strategies.map((s) => `  - ${s.id}: ${s.name} — ${s.whenToUse}`).join("\n");
  return [
    "VULNERABILITY CLASSES (what to look for + how to judge — fetch full rubric with get_knowledge):",
    vulns || "  (none)",
    "",
    "PERSONAS (who to be):",
    personas || "  (none)",
    "",
    "STRATEGIES (how to apply pressure):",
    strategies || "  (none)",
  ].join("\n");
}
