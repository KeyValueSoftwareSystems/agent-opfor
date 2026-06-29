import { readFile } from "node:fs/promises";
import { parse as parseYaml } from "yaml";
import { type EvaluatorCategory } from "../config/evaluatorsLayout.js";
import { discoverEvaluatorFiles, discoverSuiteFiles } from "./discoverEvaluators.js";
import { resolveStandardsFromFrontmatter } from "../evaluators/standards.js";
import { loadAtlasTechniqueIdSet } from "../standards/atlas.js";
import { log } from "../lib/logger.js";
import type { StandardsMap } from "../evaluators/schema.js";

export interface EvaluatorMeta {
  id: string;
  name: string;
  severity: "critical" | "high" | "medium" | "low";
  standards?: StandardsMap;
  surfaces?: Array<"agent" | "browser" | "mcp">;
}

export interface SuiteMeta {
  id: string;
  name: string;
  description: string;
  evaluatorIds: string[];
  /** True if this suite was derived from standards tags, not from a file. */
  derived?: boolean;
}

function normalizeSeverity(s: string): EvaluatorMeta["severity"] {
  const v = s.toLowerCase();
  if (v === "critical" || v === "high" || v === "medium" || v === "low") return v;
  return "high";
}

/**
 * Derive standard suites from evaluator standards tags.
 * E.g., all evaluators with standards.owasp-llm become part of "owasp-llm-top10".
 */
function deriveStandardSuites(evaluators: EvaluatorMeta[]): SuiteMeta[] {
  const standardGroups: Record<string, string[]> = {
    "owasp-llm": [],
    "owasp-agentic": [],
    "owasp-mcp": [],
    atlas: [],
    "eu-ai-act": [],
  };

  for (const ev of evaluators) {
    if (!ev.standards) continue;
    for (const key of Object.keys(ev.standards)) {
      if (key in standardGroups) {
        standardGroups[key].push(ev.id);
      }
    }
  }

  const suites: SuiteMeta[] = [];

  if (standardGroups["owasp-llm"].length > 0) {
    suites.push({
      id: "owasp-llm-top10",
      name: "OWASP LLM Top 10",
      description: "Security testing for LLM applications based on OWASP LLM Top 10",
      evaluatorIds: standardGroups["owasp-llm"],
      derived: true,
    });
  }

  if (standardGroups["owasp-agentic"].length > 0) {
    suites.push({
      id: "owasp-agentic-ai",
      name: "OWASP Agentic AI",
      description: "Security testing for agentic AI systems",
      evaluatorIds: standardGroups["owasp-agentic"],
      derived: true,
    });
  }

  if (standardGroups["owasp-mcp"].length > 0) {
    suites.push({
      id: "owasp-mcp-top10",
      name: "OWASP MCP Top 10",
      description: "Security testing for MCP servers",
      evaluatorIds: standardGroups["owasp-mcp"],
      derived: true,
    });
  }

  if (standardGroups["atlas"].length > 0) {
    suites.push({
      id: "mitre-atlas",
      name: "MITRE ATLAS",
      description: "Adversarial threat landscape for AI systems",
      evaluatorIds: standardGroups["atlas"],
      derived: true,
    });
  }

  if (standardGroups["eu-ai-act"].length > 0) {
    suites.push({
      id: "eu-ai-act-bias",
      name: "EU AI Act Bias",
      description: "Bias testing for EU AI Act compliance",
      evaluatorIds: standardGroups["eu-ai-act"],
      derived: true,
    });
  }

  return suites;
}

export async function loadEvaluatorCatalog(category: EvaluatorCategory): Promise<{
  evaluators: EvaluatorMeta[];
  suites: SuiteMeta[];
}> {
  const validateAtlas = process.env.OPFOR_VALIDATE_ATLAS !== "0"; // On by default now
  let atlasTechniqueIds: Set<string> | null = null;
  if (validateAtlas) {
    try {
      atlasTechniqueIds = await loadAtlasTechniqueIdSet();
    } catch (e: unknown) {
      // ATLAS data is an authoring-time validation aid. If it's unavailable at runtime
      // (e.g. a published install where the data wasn't bundled), skip validation rather
      // than crash a scan. Set OPFOR_VALIDATE_ATLAS=0 to silence this.
      const msg = e instanceof Error ? e.message : String(e);
      log.warn(`Skipping ATLAS technique-id validation: ${msg.split("\n")[0]}`);
    }
  }

  // Discover and load evaluators
  const discoveredEvaluators = await discoverEvaluatorFiles(category);
  const evaluators: EvaluatorMeta[] = [];

  for (const d of discoveredEvaluators) {
    try {
      const raw = await readFile(d.filePath, "utf8");
      const doc = parseYaml(raw) as Record<string, unknown>;

      const id = typeof doc.id === "string" && doc.id.trim() ? doc.id.trim() : "";
      if (!id) continue;

      const standards = resolveStandardsFromFrontmatter(doc);

      // Validate ATLAS ID
      const atlasId = standards?.atlas;
      if (atlasTechniqueIds && typeof atlasId === "string" && atlasId.trim()) {
        const normalized = atlasId.trim();
        if (!/^AML\.T\d{4}(\.\d{3})?$/.test(normalized)) {
          throw new Error(
            `Evaluator ${d.filePath}: standards.atlas has invalid format "${normalized}"`
          );
        }
        if (!atlasTechniqueIds.has(normalized)) {
          throw new Error(
            `Evaluator ${d.filePath}: standards.atlas unknown technique id "${normalized}"`
          );
        }
      }

      const surfaces = Array.isArray(doc.surfaces)
        ? (doc.surfaces as string[]).filter(
            (s): s is "agent" | "browser" | "mcp" => s === "agent" || s === "browser" || s === "mcp"
          )
        : undefined;

      evaluators.push({
        id,
        name: typeof doc.name === "string" ? doc.name : id,
        ...(standards ? { standards } : {}),
        severity: normalizeSeverity(typeof doc.severity === "string" ? doc.severity : "high"),
        ...(surfaces?.length ? { surfaces } : {}),
      });
    } catch (e) {
      console.error(`Failed to load evaluator ${d.filePath}: ${e}`);
    }
  }

  evaluators.sort((a, b) => a.id.localeCompare(b.id));

  // Discover and load curated suites
  const discoveredSuites = await discoverSuiteFiles(category);
  const suites: SuiteMeta[] = [];

  for (const d of discoveredSuites) {
    try {
      const raw = await readFile(d.filePath, "utf8");
      const doc = parseYaml(raw) as Record<string, unknown>;

      const id = typeof doc.id === "string" ? doc.id.trim() : "";
      if (!id) continue;

      const ev = doc.evaluators;
      if (!Array.isArray(ev) || ev.some((x) => typeof x !== "string")) {
        throw new Error(`Suite ${d.filePath}: must have evaluators: [string, ...]`);
      }

      suites.push({
        id,
        name: typeof doc.name === "string" ? doc.name : id,
        description: typeof doc.description === "string" ? doc.description : "",
        evaluatorIds: ev as string[],
      });
    } catch (e) {
      console.error(`Failed to load suite ${d.filePath}: ${e}`);
    }
  }

  // Add derived standard suites
  const derivedSuites = deriveStandardSuites(evaluators);
  suites.push(...derivedSuites);

  suites.sort((a, b) => a.id.localeCompare(b.id));

  return { evaluators, suites };
}

export function getEvaluatorIdSet(catalog: { evaluators: EvaluatorMeta[] }): Set<string> {
  return new Set(catalog.evaluators.map((e) => e.id));
}

export function resolveSuiteEvaluatorIds(suiteId: string, suites: SuiteMeta[]): string[] {
  const suite = suites.find((s) => s.id === suiteId);
  if (!suite) throw new Error(`Unknown suite: "${suiteId}"`);
  return [...suite.evaluatorIds];
}
