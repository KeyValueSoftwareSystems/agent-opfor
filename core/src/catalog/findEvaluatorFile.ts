import { readdir, readFile, stat } from "node:fs/promises";
import path from "node:path";
import { parse as parseYaml } from "yaml";
import { getEvaluatorsDir, type EvaluatorCategory } from "../config/evaluatorsLayout.js";

async function isDir(p: string): Promise<boolean> {
  try {
    return (await stat(p)).isDirectory();
  } catch {
    return false;
  }
}

/**
 * Walk the evaluator tree for `category` and return the absolute path to the
 * YAML file whose top-level `id` field matches `evaluatorId`.
 *
 * Handles both folder-based (`evaluator.yaml`) and flat-file evaluators.
 * Skips pattern files in `patterns/` subdirectories.
 */
export async function findEvaluatorFile(
  evaluatorId: string,
  category: EvaluatorCategory
): Promise<string> {
  const root = getEvaluatorsDir(category);

  async function search(dir: string): Promise<string | null> {
    let entries: string[];
    try {
      entries = await readdir(dir);
    } catch {
      return null;
    }
    for (const entry of entries.sort()) {
      const full = path.join(dir, entry);
      if (await isDir(full)) {
        if (entry === "patterns") continue;
        const found = await search(full);
        if (found) return found;
      } else if (entry.endsWith(".yaml") && !entry.endsWith(".test.yaml")) {
        const raw = await readFile(full, "utf8");
        const doc = parseYaml(raw) as Record<string, unknown>;
        if (typeof doc?.id === "string" && doc.id.trim() === evaluatorId) {
          return full;
        }
      }
    }
    return null;
  }

  const found = await search(root);
  if (!found) {
    throw new Error(`Evaluator "${evaluatorId}" not found in ${root}`);
  }
  return found;
}

/**
 * Load and parse a YAML evaluator file, returning the raw parsed object.
 */
export async function loadEvaluatorYaml(
  evaluatorId: string,
  category: EvaluatorCategory
): Promise<{ doc: Record<string, unknown>; filePath: string }> {
  const filePath = await findEvaluatorFile(evaluatorId, category);
  const raw = await readFile(filePath, "utf8");
  const doc = parseYaml(raw) as Record<string, unknown>;
  return { doc, filePath };
}
