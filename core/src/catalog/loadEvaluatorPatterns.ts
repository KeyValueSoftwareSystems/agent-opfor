import { readFile } from "node:fs/promises";
import path from "node:path";
import { parse as parseYaml } from "yaml";
import { getEvaluatorsDir } from "../config/evaluatorsLayout.js";
import { splitYamlFrontmatter } from "../util/yamlFrontmatter.js";

export interface EvaluatorPattern {
  name: string;
  template: string;
}

export interface EvaluatorDoc {
  id: string;
  name: string;
  patterns: EvaluatorPattern[];
}

export async function loadEvaluatorDoc(evaluatorId: string): Promise<EvaluatorDoc> {
  const dir = getEvaluatorsDir("mcp");
  const mdPath = path.join(dir, `${evaluatorId}.md`);
  const raw = await readFile(mdPath, "utf8");
  const sp = splitYamlFrontmatter(raw);
  if (!sp) throw new Error(`Evaluator ${evaluatorId}: missing YAML frontmatter`);
  const doc = parseYaml(sp.yaml) as Record<string, unknown>;
  const id = typeof doc.id === "string" && doc.id.trim() ? doc.id.trim() : evaluatorId;
  const name = typeof doc.name === "string" ? doc.name : id;
  const patternsRaw = doc.patterns;
  const patterns: EvaluatorPattern[] = [];
  if (Array.isArray(patternsRaw)) {
    for (const p of patternsRaw) {
      if (!p || typeof p !== "object") continue;
      const rec = p as Record<string, unknown>;
      const n = typeof rec.name === "string" ? rec.name : "";
      const t = typeof rec.template === "string" ? rec.template : "";
      if (n && t) patterns.push({ name: n, template: t });
    }
  }
  return { id, name, patterns };
}
