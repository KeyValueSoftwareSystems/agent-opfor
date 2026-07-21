/**
 * Shared catalog-building primitives used by BOTH build-time catalog generators:
 *   - scripts/build-catalog.ts                   → skills catalogs (agent + mcp)
 *   - runners/extension/scripts/build-catalog.mjs → extension catalog (agent only)
 *
 * The runtime readers (CLI / MCP / SDK) do NOT use this — they read the
 * evaluator/suite YAML tree directly via core at runtime. This module only
 * exists so the two *build-time* generators stop re-implementing (and drifting
 * on) the same walk → parse → derive-standard-suites logic.
 *
 * Plain ESM (no TypeScript, no core imports) on purpose: the skills generator
 * runs BEFORE `tsc -b core` in the root build, so nothing here may depend on
 * `core/dist`. Both wrappers import this file directly.
 *
 * Wrappers keep only their genuine differences:
 *   - which evaluators to include (extension drops pattern-less source-scan
 *     evaluators; skills keep them),
 *   - the output field set / envelope (extension camelCase subset; skills the
 *     same camelCase base plus whitebox + MCP fields).
 */
import { readFile, readdir, stat } from "node:fs/promises";
import path from "node:path";
import { parse as parseYaml } from "yaml";

const SKIP_DIRS = new Set(["patterns", "_shared", "node_modules", ".git"]);

/**
 * Recursively discover evaluator files under a surface dir. Returns both
 * directory-form (`<id>/evaluator.yaml` + `patterns/`) and flat-file
 * (`<id>.yaml`, inline patterns) evaluators. `*.test.yaml` fixtures are ignored.
 */
export async function discoverEvaluatorFiles(baseDir) {
  const results = [];

  async function walk(dir) {
    let entries;
    try {
      entries = await readdir(dir);
    } catch {
      return;
    }

    for (const entry of entries.sort()) {
      const fullPath = path.join(dir, entry);
      let s;
      try {
        s = await stat(fullPath);
      } catch {
        continue;
      }

      if (s.isDirectory()) {
        if (SKIP_DIRS.has(entry)) continue;

        const evaluatorYaml = path.join(fullPath, "evaluator.yaml");
        try {
          if ((await stat(evaluatorYaml)).isFile()) {
            results.push({ filePath: evaluatorYaml, dirPath: fullPath });
            continue;
          }
        } catch {
          // no evaluator.yaml here — keep walking
        }
        await walk(fullPath);
      } else if (
        /\.ya?ml$/i.test(entry) &&
        !/\.test\.ya?ml$/i.test(entry) &&
        entry !== "evaluator.yaml"
      ) {
        results.push({ filePath: fullPath, dirPath: dir, flatFile: true });
      }
    }
  }

  await walk(baseDir);
  return results;
}

async function discoverPatternFiles(evaluatorDir) {
  const patternsDir = path.join(evaluatorDir, "patterns");
  const results = [];
  try {
    for (const entry of (await readdir(patternsDir)).sort()) {
      if (/\.ya?ml$/i.test(entry)) {
        results.push({
          filePath: path.join(patternsDir, entry),
          name: entry.replace(/\.ya?ml$/i, ""),
        });
      }
    }
  } catch {
    // no patterns/ directory
  }
  return results;
}

/** Discover flat suite YAML files under suites/<surface>/. */
export async function discoverSuiteFiles(baseDir) {
  const results = [];
  try {
    for (const entry of (await readdir(baseDir)).sort()) {
      if (/\.ya?ml$/i.test(entry)) results.push(path.join(baseDir, entry));
    }
  } catch {
    // directory doesn't exist for this surface
  }
  return results;
}

function str(doc, key) {
  const v = doc[key];
  return typeof v === "string" ? v : "";
}

function normalizeSeverity(s) {
  const v = (s || "").toLowerCase();
  if (v === "critical" || v === "high" || v === "medium" || v === "low") return v;
  return "high";
}

function parseStandards(doc) {
  const raw = doc.standards;
  if (raw && typeof raw === "object" && !Array.isArray(raw)) {
    const out = {};
    for (const [k, v] of Object.entries(raw)) {
      if (typeof k === "string" && k.trim() && typeof v === "string" && v.trim()) {
        out[k.trim()] = v.trim();
      }
    }
    if (Object.keys(out).length > 0) return out;
  }
  return undefined;
}

/**
 * Parse one evaluator into a normalized, camelCase object holding the full
 * superset of fields any consumer needs. Lenient about patterns: a source-scan
 * evaluator legitimately has none (it reads code, it doesn't send prompts), so
 * empty patterns are returned as `[]` rather than throwing. The extension
 * wrapper is the one that chooses to drop pattern-less evaluators.
 *
 * Throws only on genuinely invalid input (bad YAML, missing id/name).
 */
export async function parseEvaluator(discovered) {
  const { filePath, dirPath } = discovered;
  const doc = parseYaml(await readFile(filePath, "utf8"));
  if (!doc || typeof doc !== "object") throw new Error(`Invalid YAML in ${filePath}`);

  const id = str(doc, "id").trim();
  const name = str(doc, "name").trim();
  if (!id) throw new Error(`${filePath}: must set id`);
  if (!name) throw new Error(`${filePath}: must set name`);

  const patterns = [];
  if (Array.isArray(doc.patterns)) {
    for (const item of doc.patterns) {
      if (!item || typeof item !== "object") continue;
      const pName = str(item, "name").trim();
      const template = str(item, "template").trim();
      if (pName && template) {
        const pattern = { name: pName, template };
        const judgeHint = str(item, "judge_hint").trim();
        if (judgeHint) pattern.judgeHint = judgeHint;
        patterns.push(pattern);
      }
    }
  }
  if (patterns.length === 0) {
    for (const pf of await discoverPatternFiles(dirPath)) {
      try {
        const p = parseYaml(await readFile(pf.filePath, "utf8"));
        if (!p || typeof p !== "object") continue;
        const pName = typeof p.name === "string" ? p.name.trim() : pf.name;
        const template = typeof p.template === "string" ? p.template.trim() : "";
        if (template) {
          const pattern = { name: pName, template };
          const judgeHint = typeof p.judge_hint === "string" ? p.judge_hint.trim() : "";
          if (judgeHint) pattern.judgeHint = judgeHint;
          patterns.push(pattern);
        }
      } catch (e) {
        console.warn(`[catalog] skip pattern ${pf.filePath}: ${e.message}`);
      }
    }
  }

  const evaluator = {
    id,
    name,
    severity: normalizeSeverity(str(doc, "severity")),
    description: str(doc, "description"),
    passCriteria: str(doc, "pass_criteria") || str(doc, "passCriteria"),
    failCriteria: str(doc, "fail_criteria") || str(doc, "failCriteria"),
    patterns,
  };

  const standards = parseStandards(doc);
  if (standards) evaluator.standards = standards;

  const judgeHint = str(doc, "judge_hint").trim();
  if (judgeHint) evaluator.judgeHint = judgeHint;

  // Whitebox / static-source-scan metadata (used by the skills' source pre-scan).
  const scanMode = str(doc, "scan_mode").trim();
  if (scanMode) evaluator.scanMode = scanMode;
  const correlatesWith = str(doc, "correlates_with").trim();
  if (correlatesWith) evaluator.correlatesWith = correlatesWith;
  if (doc.source_scan && typeof doc.source_scan === "object") {
    evaluator.sourceScan = doc.source_scan;
  }

  // MCP-specific judging metadata.
  if (typeof doc.judge_needs_llm === "boolean") evaluator.judgeNeedsLlm = doc.judge_needs_llm;
  if (typeof doc.applies_to_all_tools === "boolean") {
    evaluator.appliesToAllTools = doc.applies_to_all_tools;
  }
  const mcpTop10 = str(doc, "mcp_top_10").trim();
  if (mcpTop10) evaluator.mcpTop10 = mcpTop10;
  const judgeInstructions = str(doc, "judge_instructions").trim();
  if (judgeInstructions) evaluator.judgeInstructions = judgeInstructions;

  // Informational only (docs/evaluator-schema.md) — carried through for parity with core.
  if (Array.isArray(doc.surfaces) && doc.surfaces.length > 0) {
    const surfaces = doc.surfaces.filter((s) => s === "agent" || s === "browser" || s === "mcp");
    if (surfaces.length > 0) evaluator.surfaces = surfaces;
  }

  // Extension-only optional fields (absent in the current tree, kept for parity).
  const strategy = str(doc, "strategy").trim();
  if (strategy) evaluator.strategy = strategy;
  const turnMode = str(doc, "turn_mode").trim();
  if (turnMode) evaluator.turnMode = turnMode;

  return evaluator;
}

/** Parse one curated suite YAML into `{ id, name, description, evaluatorIds }`. */
export async function parseSuite(filePath) {
  const doc = parseYaml(await readFile(filePath, "utf8"));
  if (!doc || typeof doc !== "object") throw new Error(`Invalid YAML in ${filePath}`);
  const id = str(doc, "id").trim();
  if (!id) throw new Error(`${filePath}: must set id`);
  const ev = doc.evaluators;
  if (!Array.isArray(ev) || ev.some((x) => typeof x !== "string")) {
    throw new Error(`${filePath}: must have evaluators: [string, ...]`);
  }
  return {
    id,
    name: typeof doc.name === "string" ? doc.name.trim() : id,
    description: typeof doc.description === "string" ? doc.description.trim() : "",
    evaluatorIds: ev.map((x) => String(x).trim()).filter(Boolean),
  };
}

/**
 * Derive standard suites (OWASP LLM / Agentic / MCP, MITRE ATLAS, EU AI Act)
 * from the `standards:` tags of the given evaluators. Callers pass the FINAL
 * evaluator list they will ship so derived suites never reference an evaluator
 * that was filtered out.
 */
export function deriveStandardSuites(evaluators) {
  const standardGroups = {
    "owasp-llm": [],
    "owasp-api": [],
    "owasp-agentic": [],
    "owasp-mcp": [],
    atlas: [],
    "eu-ai-act": [],
    nist: [],
  };

  for (const ev of evaluators) {
    if (!ev.standards) continue;
    for (const key of Object.keys(ev.standards)) {
      if (key in standardGroups) standardGroups[key].push(ev.id);
    }
  }

  const defs = [
    {
      group: "owasp-llm",
      id: "owasp-llm-top10",
      name: "OWASP LLM Top 10",
      description: "Security testing for LLM applications based on OWASP LLM Top 10",
    },
    {
      group: "owasp-api",
      id: "owasp-api-top10",
      name: "OWASP API Top 10",
      description:
        "Security testing for LLM-integrated APIs based on OWASP API Security Top 10 (2023)",
    },
    {
      group: "owasp-agentic",
      id: "owasp-agentic-ai",
      name: "OWASP Agentic AI",
      description: "Security testing for agentic AI systems",
    },
    {
      group: "owasp-mcp",
      id: "owasp-mcp-top10",
      name: "OWASP MCP Top 10",
      description: "Security testing for MCP servers",
    },
    {
      group: "atlas",
      id: "mitre-atlas",
      name: "MITRE ATLAS",
      description: "Adversarial threat landscape for AI systems",
    },
    {
      group: "eu-ai-act",
      id: "eu-ai-act",
      name: "EU AI Act",
      description:
        "EU AI Act compliance testing across data governance/bias (Art.10), accuracy & robustness (Art.15), prohibited manipulation (Art.5), and transparency (Art.50)",
    },
    {
      group: "nist",
      id: "nist-ai-rmf",
      name: "NIST AI RMF",
      description:
        "NIST AI Risk Management Framework — representative coverage across the trustworthy-AI characteristics",
    },
  ];

  const suites = [];
  for (const d of defs) {
    if (standardGroups[d.group].length > 0) {
      suites.push({
        id: d.id,
        name: d.name,
        description: d.description,
        evaluatorIds: standardGroups[d.group],
        derived: true,
      });
    }
  }
  return suites;
}

/**
 * Parse every evaluator under a surface dir, skipping (with a warning) any that
 * fail to parse. Returns the full normalized objects, sorted by id. Callers
 * apply their own include/exclude policy and serialization afterward.
 *
 * Does not check for duplicate ids — `scripts/validate-skills.ts` already hard-errors on those.
 */
export async function parseAllEvaluators(evaluatorsDir) {
  const discovered = await discoverEvaluatorFiles(evaluatorsDir);
  const evaluators = [];
  for (const d of discovered) {
    try {
      evaluators.push(await parseEvaluator(d));
    } catch (e) {
      console.warn(`[catalog] skip ${d.filePath}: ${e.message}`);
    }
  }
  evaluators.sort((a, b) => a.id.localeCompare(b.id));
  return evaluators;
}

/** Parse every curated suite under a surface dir, sorted by id. */
export async function parseAllSuites(suitesDir) {
  const files = await discoverSuiteFiles(suitesDir);
  const suites = [];
  for (const f of files) {
    try {
      suites.push(await parseSuite(f));
    } catch (e) {
      console.warn(`[catalog] skip suite ${f}: ${e.message}`);
    }
  }
  return suites;
}

/** Warn about any suite that references an evaluator id not present in `evaluators`. */
export function warnDanglingSuiteRefs(suites, evaluators) {
  const known = new Set(evaluators.map((e) => e.id));
  for (const s of suites) {
    const missing = s.evaluatorIds.filter((id) => !known.has(id));
    if (missing.length) {
      console.warn(
        `[catalog] suite ${s.id} references unknown evaluator ids: ${missing.join(", ")}`
      );
    }
  }
}
