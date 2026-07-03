// Loader for hunt-mode vulnerability classes, derived from the evaluator
// taxonomy (`evaluators/agent/<category>/README.md`) rather than a separate
// hand-maintained library — so the autonomous agent hunts the same categories
// `opfor run` covers and stays in sync as evaluators are added.

import { readFile } from "node:fs/promises";
import path from "node:path";
import { parse as parseYaml } from "yaml";
import { getEvaluatorsDir } from "../../config/evaluatorsLayout.js";
import { CategoryFrontmatterSchema } from "../../evaluators/schema.js";
import { splitYamlFrontmatter } from "../../util/yamlFrontmatter.js";
import type { VulnClass } from "./types.js";

/**
 * Evaluator agent-categories (`evaluators/agent/<id>/`) that `opfor hunt` draws
 * its vuln-class seed knowledge from. A hand-picked allowlist, NOT "all
 * categories" — chosen for fit with hunt's black-box, chat-only, LLM-judged model.
 *
 * Deliberately excluded: `memory-rag` and `source-analysis` (per product decision);
 * `code-execution`, `resource` (deterministic metric evaluator), `multi-agent`,
 * `supply-chain` (poor fit for conversational probing); and all `evaluators/mcp/*`
 * (hunt has no MCP-server target — it is agent-redteaming only).
 *
 * Revisit this list when adding an `evaluators/agent/<category>/` that should also
 * be huntable, and ensure that category's README carries a `severity:` field.
 */
export const HUNT_VULN_CLASS_CATEGORIES = [
  "bias",
  "harmful",
  "accuracy",
  "disclosure",
  "injection",
  "excessive-agency",
  "brand-conduct",
  "access-control",
  "mcp-usage",
] as const;

/**
 * Load the allow-listed vulnerability classes from their evaluator category
 * READMEs. Reads each id directly (not a directory walk): the allowlist is fixed,
 * so a missing/renamed category should fail loud — a silently shorter list would
 * be indistinguishable from data corruption (and hunt already throws on an empty
 * vuln-class set in the orchestrator).
 *
 * @param evaluatorsDir Override the `evaluators/agent` directory (tests only).
 */
export async function loadVulnClasses(evaluatorsDir?: string): Promise<VulnClass[]> {
  const dir = evaluatorsDir ?? getEvaluatorsDir("agent");
  const results: VulnClass[] = [];
  for (const id of HUNT_VULN_CLASS_CATEGORIES) {
    const readmePath = path.join(dir, id, "README.md");
    const raw = await readFile(readmePath, "utf8");
    const split = splitYamlFrontmatter(raw);
    if (!split) {
      throw new Error(`${readmePath}: missing YAML frontmatter`);
    }
    let doc: unknown;
    try {
      doc = parseYaml(split.yaml);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      throw new Error(`${readmePath}: invalid YAML frontmatter: ${msg}`, { cause: err });
    }
    const parsed = CategoryFrontmatterSchema.safeParse(doc);
    if (!parsed.success) {
      const issues = parsed.error.issues
        .map((i) => `${i.path.join(".") || "(root)"}: ${i.message}`)
        .join("; ");
      const missingSeverity = parsed.error.issues.some((i) => i.path.join(".") === "severity");
      throw new Error(
        `${readmePath}: category frontmatter invalid: ${issues}.` +
          (missingSeverity
            ? " Category READMEs consumed by opfor hunt require a severity: field."
            : "")
      );
    }
    const fm = parsed.data;
    // Fail loud on a README whose frontmatter id drifts from its directory/allowlist
    // key, rather than silently minting a VulnClass under the wrong id.
    if (fm.id !== id) {
      throw new Error(
        `${readmePath}: frontmatter id "${fm.id}" does not match expected category "${id}"`
      );
    }
    // Category standards may list multiple ids per framework; VulnClass.standards
    // is a flat string map, so join lists into a comma-separated string.
    const standards = fm.standards
      ? Object.fromEntries(
          Object.entries(fm.standards).map(([k, v]) => [k, Array.isArray(v) ? v.join(", ") : v])
        )
      : undefined;
    results.push({
      id: fm.id,
      name: fm.name,
      severity: fm.severity,
      standards,
      description: fm.description,
      failRubric: fm.fail_rubric,
      passRubric: fm.pass_rubric,
    });
  }
  return results;
}
