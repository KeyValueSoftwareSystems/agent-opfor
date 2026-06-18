import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { parse as parseYaml } from "yaml";
import { loadEvaluatorYaml } from "./findEvaluatorFile.js";
import type { EvaluatorCategory } from "../config/evaluatorsLayout.js";

export interface EvaluatorPattern {
  name: string;
  template: string;
}

export interface EvaluatorDoc {
  id: string;
  name: string;
  patterns: EvaluatorPattern[];
}

export async function loadEvaluatorDoc(
  evaluatorId: string,
  category: EvaluatorCategory = "mcp"
): Promise<EvaluatorDoc> {
  const { doc, filePath } = await loadEvaluatorYaml(evaluatorId, category);
  const id = typeof doc.id === "string" && doc.id.trim() ? doc.id.trim() : evaluatorId;
  const name = typeof doc.name === "string" ? doc.name : id;
  const patterns: EvaluatorPattern[] = [];

  if (path.basename(filePath) === "evaluator.yaml") {
    // Folder-based: load from sibling patterns/ directory
    const patternsDir = path.join(path.dirname(filePath), "patterns");
    let files: string[];
    try {
      files = (await readdir(patternsDir)).filter((f) => f.endsWith(".yaml")).sort();
    } catch {
      files = [];
    }
    for (const f of files) {
      const raw = await readFile(path.join(patternsDir, f), "utf8");
      const p = parseYaml(raw) as Record<string, unknown>;
      const n = typeof p?.name === "string" ? p.name : "";
      const t = typeof p?.template === "string" ? p.template : "";
      if (n && t) patterns.push({ name: n, template: t });
    }
  } else {
    // Flat-file: inline patterns array
    const patternsRaw = doc.patterns;
    if (Array.isArray(patternsRaw)) {
      for (const p of patternsRaw) {
        if (!p || typeof p !== "object") continue;
        const rec = p as Record<string, unknown>;
        const n = typeof rec.name === "string" ? rec.name : "";
        const t = typeof rec.template === "string" ? rec.template : "";
        if (n && t) patterns.push({ name: n, template: t });
      }
    }
  }

  return { id, name, patterns };
}
