import { readdir, readFile, stat } from "node:fs/promises";
import path from "node:path";
import { parse as parseYaml } from "yaml";
import {
  getEvaluatorsDir,
  getSuitesDir,
  type EvaluatorCategory,
} from "../config/evaluatorsLayout.js";
import { resolveStandardsFromFrontmatter } from "../evaluators/standards.js";
import { loadAtlasTechniqueIdSet } from "../standards/atlas.js";
import type { StandardsMap } from "../evaluators/schema.js";

export interface EvaluatorMeta {
  id: string;
  name: string;
  severity: "critical" | "high" | "medium" | "low";
  standards?: StandardsMap;
}

export interface SuiteMeta {
  id: string;
  name: string;
  description: string;
  evaluatorIds: string[];
}

function normalizeSeverity(s: string): EvaluatorMeta["severity"] {
  const v = s.toLowerCase();
  if (v === "critical" || v === "high" || v === "medium" || v === "low") return v;
  return "high";
}

async function isDir(p: string): Promise<boolean> {
  try {
    return (await stat(p)).isDirectory();
  } catch {
    return false;
  }
}

async function walkYamlFiles(dir: string): Promise<string[]> {
  const results: string[] = [];

  async function recurse(d: string): Promise<void> {
    let entries: string[];
    try {
      entries = await readdir(d);
    } catch {
      return;
    }
    for (const entry of entries.sort()) {
      const full = path.join(d, entry);
      if (await isDir(full)) {
        await recurse(full);
      } else if (entry.endsWith(".yaml") && !entry.endsWith(".test.yaml")) {
        results.push(full);
      }
    }
  }

  await recurse(dir);
  return results;
}

export async function loadEvaluatorCatalog(category: EvaluatorCategory): Promise<{
  evaluators: EvaluatorMeta[];
  suites: SuiteMeta[];
}> {
  const validateAtlas = process.env.OPFOR_VALIDATE_ATLAS === "1";
  const atlasTechniqueIds = validateAtlas ? await loadAtlasTechniqueIdSet() : null;

  const suitesDir = getSuitesDir();

  let suiteFiles: string[];
  try {
    suiteFiles = (await readdir(suitesDir)).filter((f) => f.endsWith(".yaml"));
  } catch {
    suiteFiles = [];
  }
  const suites: SuiteMeta[] = [];
  for (const f of suiteFiles) {
    const raw = await readFile(path.join(suitesDir, f), "utf8");
    const doc = parseYaml(raw) as Record<string, unknown>;
    const id = doc.id;
    if (typeof id !== "string" || !id.trim()) continue;
    const ev = doc.evaluators;
    if (!Array.isArray(ev) || ev.some((x) => typeof x !== "string")) continue;
    suites.push({
      id: id.trim(),
      name: typeof doc.name === "string" ? doc.name : id.trim(),
      description: typeof doc.description === "string" ? doc.description : "",
      evaluatorIds: ev as string[],
    });
  }
  suites.sort((a, b) => a.id.localeCompare(b.id));

  const evalDir = getEvaluatorsDir(category);
  const allYaml = await walkYamlFiles(evalDir);
  const evaluators: EvaluatorMeta[] = [];
  const seen = new Set<string>();

  for (const filePath of allYaml) {
    const rel = path.relative(evalDir, filePath);

    // Skip pattern files
    if (rel.includes("/patterns/")) continue;

    const raw = await readFile(filePath, "utf8");
    const doc = parseYaml(raw) as Record<string, unknown>;
    const id = typeof doc.id === "string" && doc.id.trim() ? doc.id.trim() : undefined;
    if (!id) continue;
    if (seen.has(id)) continue;
    seen.add(id);

    const standards = resolveStandardsFromFrontmatter(doc);
    const atlasId = standards?.atlas;
    if (atlasTechniqueIds && typeof atlasId === "string" && atlasId.trim()) {
      const normalized = atlasId.trim();
      if (!/^AML\.T\d{4}(\.\d{3})?$/.test(normalized)) {
        throw new Error(`Evaluator ${rel}: standards.atlas has invalid format "${normalized}"`);
      }
      if (!atlasTechniqueIds.has(normalized)) {
        throw new Error(`Evaluator ${rel}: standards.atlas unknown technique id "${normalized}"`);
      }
    }
    evaluators.push({
      id,
      name: typeof doc.name === "string" ? doc.name : id,
      ...(standards ? { standards } : {}),
      severity: normalizeSeverity(typeof doc.severity === "string" ? doc.severity : "high"),
    });
  }
  evaluators.sort((a, b) => a.id.localeCompare(b.id));

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
