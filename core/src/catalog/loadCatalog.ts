import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parse as parseYaml } from "yaml";
import { splitYamlFrontmatter } from "../util/yamlFrontmatter.js";

export interface EvaluatorMeta {
  id: string;
  name: string;
  severity: "critical" | "high" | "medium" | "low";
  owasp: string;
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

/** `skills/mcp-redteaming` at repo root — MCP-server-direct evaluator catalog. */
export function getCatalogRoot(): string {
  const here = path.dirname(fileURLToPath(import.meta.url));
  return path.resolve(here, "..", "..", "..", "skills", "mcp-redteaming");
}

export async function loadCatalog(): Promise<{
  evaluators: EvaluatorMeta[];
  suites: SuiteMeta[];
}> {
  const root = getCatalogRoot();
  const evalDir = path.join(root, "evaluators");
  const suitesDir = path.join(root, "suites");

  const suiteFiles = (await readdir(suitesDir)).filter((f) => f.endsWith(".md"));
  const suites: SuiteMeta[] = [];
  for (const f of suiteFiles) {
    const raw = await readFile(path.join(suitesDir, f), "utf8");
    const sp = splitYamlFrontmatter(raw);
    if (!sp) throw new Error(`Suite ${f}: missing YAML frontmatter (leading --- block)`);
    const doc = parseYaml(sp.yaml) as Record<string, unknown>;
    const id = doc.id;
    if (typeof id !== "string" || !id.trim()) {
      throw new Error(`Suite ${f}: frontmatter must set id (string)`);
    }
    const ev = doc.evaluators;
    if (!Array.isArray(ev) || ev.some((x) => typeof x !== "string")) {
      throw new Error(`Suite ${f}: frontmatter must set evaluators: [string, ...]`);
    }
    suites.push({
      id: id.trim(),
      name: typeof doc.name === "string" ? doc.name : id.trim(),
      description: typeof doc.description === "string" ? doc.description : "",
      evaluatorIds: ev as string[],
    });
  }
  suites.sort((a, b) => a.id.localeCompare(b.id));

  const evalFiles = (await readdir(evalDir)).filter((f) => f.endsWith(".md"));
  const evaluators: EvaluatorMeta[] = [];
  for (const f of evalFiles) {
    const mdPath = path.join(evalDir, f);
    const raw = await readFile(mdPath, "utf8");
    const sp = splitYamlFrontmatter(raw);
    if (!sp) throw new Error(`Evaluator ${f}: missing YAML frontmatter`);
    const doc = parseYaml(sp.yaml) as Record<string, unknown>;
    const id =
      typeof doc.id === "string" && doc.id.trim() ? doc.id.trim() : f.replace(/\.md$/i, "");
    evaluators.push({
      id,
      name: typeof doc.name === "string" ? doc.name : id,
      owasp: typeof doc.owasp === "string" ? doc.owasp : "",
      severity: normalizeSeverity(typeof doc.severity === "string" ? doc.severity : "high"),
    });
  }
  evaluators.sort((a, b) => a.id.localeCompare(b.id));

  return { evaluators, suites };
}

export function getEvaluatorIdSet(catalog: { evaluators: EvaluatorMeta[] }): Set<string> {
  return new Set(catalog.evaluators.map((e) => e.id));
}
