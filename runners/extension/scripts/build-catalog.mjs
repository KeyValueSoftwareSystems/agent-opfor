#!/usr/bin/env node
/**
 * Bundles evaluator + suite metadata from repo-root `evaluators/agent` + `suites/agent`
 * into `runners/extension/catalog.json` for the MV3 extension (no filesystem access at
 * runtime).
 *
 * Run from repo root: node runners/extension/scripts/build-catalog.mjs
 *
 * Structure expected:
 *   evaluators/agent/{category}/{family}/{evaluator}/
 *     - evaluator.yaml (required)
 *     - patterns/*.yaml (attack patterns)
 *
 *   suites/agent/*.yaml (flat YAML files)
 */
import { readFile, readdir, writeFile, stat } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parse as parseYaml } from "yaml";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "../../..");
const EVALUATORS_DIR = path.join(REPO_ROOT, "evaluators/agent");
const SUITES_DIR = path.join(REPO_ROOT, "suites/agent");
const OUT = path.join(REPO_ROOT, "runners/extension/catalog.json");

/**
 * Recursively discover all evaluator.yaml files.
 */
async function discoverEvaluatorFiles(baseDir) {
  const results = [];
  const skipDirs = new Set(["patterns", "_shared", "node_modules", ".git"]);

  async function walk(dir) {
    let entries;
    try {
      entries = await readdir(dir);
    } catch {
      return;
    }

    for (const entry of entries) {
      const fullPath = path.join(dir, entry);
      let s;
      try {
        s = await stat(fullPath);
      } catch {
        continue;
      }

      if (s.isDirectory()) {
        if (skipDirs.has(entry)) continue;

        // Check if this directory contains evaluator.yaml
        const evaluatorYaml = path.join(fullPath, "evaluator.yaml");
        try {
          const evalStat = await stat(evaluatorYaml);
          if (evalStat.isFile()) {
            results.push({
              filePath: evaluatorYaml,
              dirPath: fullPath,
            });
            continue;
          }
        } catch {
          // No evaluator.yaml, continue walking
        }

        await walk(fullPath);
      } else if (
        // Flat-file evaluator: a loose <id>.yaml sibling (not evaluator.yaml,
        // not a *.test.yaml fixture). Patterns live inline, so no patterns/ dir.
        /\.ya?ml$/i.test(entry) &&
        !/\.test\.ya?ml$/i.test(entry) &&
        entry !== "evaluator.yaml"
      ) {
        results.push({
          filePath: fullPath,
          dirPath: dir,
          flatFile: true,
        });
      }
    }
  }

  await walk(baseDir);
  return results;
}

/**
 * Discover pattern files for a directory-form evaluator.
 */
async function discoverPatternFiles(evaluatorDir) {
  const patternsDir = path.join(evaluatorDir, "patterns");
  const results = [];

  try {
    const entries = await readdir(patternsDir);
    for (const entry of entries) {
      if (entry.endsWith(".yaml") || entry.endsWith(".yml")) {
        results.push({
          filePath: path.join(patternsDir, entry),
          name: entry.replace(/\.ya?ml$/i, ""),
        });
      }
    }
  } catch {
    // No patterns directory
  }

  return results;
}

/**
 * Discover all suite YAML files.
 */
async function discoverSuiteFiles(baseDir) {
  const results = [];

  try {
    const entries = await readdir(baseDir);
    for (const entry of entries) {
      if (entry.endsWith(".yaml") || entry.endsWith(".yml")) {
        results.push(path.join(baseDir, entry));
      }
    }
  } catch {
    // Directory doesn't exist
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

/**
 * Parse standards from evaluator document.
 */
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
 * Parse a single evaluator from its YAML file and patterns directory.
 */
async function parseEvaluator(discovered) {
  const { filePath, dirPath } = discovered;
  const raw = await readFile(filePath, "utf8");
  const doc = parseYaml(raw);

  if (!doc || typeof doc !== "object") {
    throw new Error(`Invalid YAML in ${filePath}`);
  }

  const id = str(doc, "id");
  const name = str(doc, "name");

  if (!id.trim()) throw new Error(`${filePath}: must set id`);
  if (!name.trim()) throw new Error(`${filePath}: must set name`);

  // Collect patterns - inline or from patterns/ directory
  const patterns = [];

  // First check for inline patterns
  if (Array.isArray(doc.patterns)) {
    for (const item of doc.patterns) {
      if (!item || typeof item !== "object") continue;
      const pName = str(item, "name");
      const template = str(item, "template");
      if (pName.trim() && template.trim()) {
        const pattern = { name: pName.trim(), template: template.trim() };
        const judgeHint = str(item, "judge_hint");
        if (judgeHint.trim()) pattern.judgeHint = judgeHint.trim();
        patterns.push(pattern);
      }
    }
  }

  // If no inline patterns, look for patterns/ directory
  if (patterns.length === 0) {
    const patternFiles = await discoverPatternFiles(dirPath);

    for (const pf of patternFiles) {
      try {
        const patternContent = await readFile(pf.filePath, "utf8");
        const patternDoc = parseYaml(patternContent);
        if (!patternDoc || typeof patternDoc !== "object") continue;

        const pName = typeof patternDoc.name === "string" ? patternDoc.name.trim() : pf.name;
        const template = typeof patternDoc.template === "string" ? patternDoc.template.trim() : "";
        const judgeHint =
          typeof patternDoc.judge_hint === "string" ? patternDoc.judge_hint.trim() : undefined;

        if (template) {
          const pattern = { name: pName, template };
          if (judgeHint) pattern.judgeHint = judgeHint;
          patterns.push(pattern);
        }
      } catch (e) {
        console.warn(`[build-catalog] skip pattern ${pf.filePath}: ${e.message}`);
      }
    }
  }

  // Check if strategy is mcp-scanner (patterns not required)
  const strategy = str(doc, "strategy");
  if (patterns.length === 0 && strategy !== "mcp-scanner") {
    throw new Error(`${filePath}: must have patterns (inline or in patterns/ directory)`);
  }

  const evaluator = {
    id: id.trim(),
    name: name.trim(),
    severity: normalizeSeverity(str(doc, "severity")),
    description: str(doc, "description"),
    passCriteria: str(doc, "pass_criteria") || str(doc, "passCriteria"),
    failCriteria: str(doc, "fail_criteria") || str(doc, "failCriteria"),
    patterns,
  };

  const standards = parseStandards(doc);
  if (standards) evaluator.standards = standards;

  const judgeHint = str(doc, "judge_hint");
  if (judgeHint.trim()) evaluator.judgeHint = judgeHint.trim();

  const surfaces = doc.surfaces;
  if (Array.isArray(surfaces) && surfaces.length > 0) {
    evaluator.surfaces = surfaces.filter((s) => s === "agent" || s === "browser" || s === "mcp");
  }

  if (strategy.trim()) evaluator.strategy = strategy.trim();

  const turnMode = str(doc, "turn_mode");
  if (turnMode.trim()) evaluator.turnMode = turnMode.trim();

  return evaluator;
}

/**
 * Parse a suite YAML file.
 */
async function parseSuite(filePath) {
  const raw = await readFile(filePath, "utf8");
  const doc = parseYaml(raw);

  if (!doc || typeof doc !== "object") {
    throw new Error(`Invalid YAML in ${filePath}`);
  }

  const id = str(doc, "id");
  if (!id.trim()) throw new Error(`${filePath}: must set id`);

  const ev = doc.evaluators;
  if (!Array.isArray(ev) || ev.some((x) => typeof x !== "string")) {
    throw new Error(`${filePath}: must have evaluators: [string, ...]`);
  }

  return {
    id: id.trim(),
    name: typeof doc.name === "string" ? doc.name.trim() : id.trim(),
    description: typeof doc.description === "string" ? doc.description.trim() : "",
    evaluatorIds: ev.map((x) => String(x).trim()).filter(Boolean),
  };
}

/**
 * Derive standard suites from evaluator standards tags.
 */
function deriveStandardSuites(evaluators) {
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
      if (key in standardGroups) {
        standardGroups[key].push(ev.id);
      }
    }
  }

  const suites = [];

  if (standardGroups["owasp-llm"].length > 0) {
    suites.push({
      id: "owasp-llm-top10",
      name: "OWASP LLM Top 10",
      description: "Security testing for LLM applications based on OWASP LLM Top 10",
      evaluatorIds: standardGroups["owasp-llm"],
      derived: true,
    });
  }

  if (standardGroups["owasp-api"].length > 0) {
    suites.push({
      id: "owasp-api-top10",
      name: "OWASP API Top 10",
      description:
        "Security testing for LLM-integrated APIs based on OWASP API Security Top 10 (2023)",
      evaluatorIds: standardGroups["owasp-api"],
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
      id: "eu-ai-act",
      name: "EU AI Act",
      description:
        "EU AI Act compliance testing across data governance/bias (Art.10), accuracy & robustness (Art.15), prohibited manipulation (Art.5), and transparency (Art.50)",
      evaluatorIds: standardGroups["eu-ai-act"],
      derived: true,
    });
  }

  if (standardGroups["nist"].length > 0) {
    suites.push({
      id: "nist-ai-rmf",
      name: "NIST AI RMF",
      description:
        "NIST AI Risk Management Framework — representative coverage across the trustworthy-AI characteristics",
      evaluatorIds: standardGroups["nist"],
      derived: true,
    });
  }

  return suites;
}

async function main() {
  console.log("[build-catalog] Starting catalog generation...");
  console.log(`[build-catalog] Evaluators dir: ${EVALUATORS_DIR}`);
  console.log(`[build-catalog] Suites dir: ${SUITES_DIR}`);

  // Discover and parse evaluators
  const discoveredEvaluators = await discoverEvaluatorFiles(EVALUATORS_DIR);
  console.log(`[build-catalog] Found ${discoveredEvaluators.length} evaluator.yaml files`);

  const evaluators = [];
  for (const d of discoveredEvaluators) {
    try {
      const ev = await parseEvaluator(d);
      evaluators.push(ev);
    } catch (e) {
      console.warn(`[build-catalog] skip ${d.filePath}: ${e.message}`);
    }
  }
  evaluators.sort((a, b) => a.id.localeCompare(b.id));

  // Discover and parse curated suites
  const suiteFiles = await discoverSuiteFiles(SUITES_DIR);
  console.log(`[build-catalog] Found ${suiteFiles.length} suite files`);

  const suites = [];
  for (const f of suiteFiles) {
    try {
      suites.push(await parseSuite(f));
    } catch (e) {
      console.warn(`[build-catalog] skip suite ${f}: ${e.message}`);
    }
  }

  // Add derived standard suites
  const derivedSuites = deriveStandardSuites(evaluators);
  suites.push(...derivedSuites);
  console.log(`[build-catalog] Derived ${derivedSuites.length} standard suites`);

  suites.sort((a, b) => a.id.localeCompare(b.id));

  // Validate suite references
  const byId = new Map(evaluators.map((e) => [e.id, e]));
  for (const s of suites) {
    const missing = s.evaluatorIds.filter((id) => !byId.has(id));
    if (missing.length) {
      console.warn(
        `[build-catalog] suite ${s.id} references unknown evaluator ids: ${missing.join(", ")}`
      );
    }
  }

  const payload = {
    version: 1,
    source: "evaluators/agent",
    suites,
    evaluators,
  };

  await writeFile(OUT, JSON.stringify(payload, null, 2) + "\n", "utf8");
  console.log(
    `[build-catalog] Wrote ${OUT} (${suites.length} suites, ${evaluators.length} evaluators)`
  );

  // Summary stats
  const withPatterns = evaluators.filter((e) => e.patterns.length > 0).length;
  const totalPatterns = evaluators.reduce((sum, e) => sum + e.patterns.length, 0);
  console.log(
    `[build-catalog] ${withPatterns} evaluators with patterns, ${totalPatterns} total patterns`
  );
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
