/**
 * Unified evaluator/suite discovery for YAML structure.
 *
 * An evaluator is discovered in either form:
 *   - Directory form: evaluators/{category}/.../{evaluator}/evaluator.yaml (+ patterns/*.yaml)
 *   - Flat-file form:  evaluators/{category}/.../{evaluator}.yaml (patterns inline)
 * (*.test.yaml files are fixtures, not evaluators, and are ignored.)
 *
 * Suites: suites/{category}/*.yaml (flat YAML files)
 */

import { readdir, readFile, stat } from "node:fs/promises";
import path from "node:path";
import { parse as parseYaml } from "yaml";
import {
  getEvaluatorsDir,
  getSuitesDir,
  type EvaluatorCategory,
} from "../config/evaluatorsLayout.js";

export interface DiscoveredEvaluator {
  filePath: string;
  dirPath: string;
  isDirectoryForm: boolean;
  category: EvaluatorCategory;
}

export interface DiscoveredPattern {
  filePath: string;
  name: string;
}

export interface DiscoveredSuite {
  filePath: string;
  category: EvaluatorCategory;
}

/**
 * Recursively discover all evaluator.yaml files in a category.
 */
export async function discoverEvaluatorFiles(
  category: EvaluatorCategory
): Promise<DiscoveredEvaluator[]> {
  const baseDir = getEvaluatorsDir(category);
  const results: DiscoveredEvaluator[] = [];

  // Flat-file form: <category>/<id>.yaml (patterns inline). Excludes the
  // directory-form marker (evaluator.yaml) and *.test.yaml fixtures.
  const isFlatEvaluatorFile = (entry: string): boolean =>
    /\.ya?ml$/i.test(entry) && !/\.test\.ya?ml$/i.test(entry) && !/^evaluator\.ya?ml$/i.test(entry);

  async function walk(dir: string): Promise<void> {
    let entries: string[];
    try {
      entries = await readdir(dir);
    } catch {
      return;
    }

    const skipDirs = new Set(["patterns", "_shared", "node_modules", ".git"]);

    for (const entry of entries) {
      const fullPath = path.join(dir, entry);
      const s = await stat(fullPath);

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
              isDirectoryForm: true,
              category,
            });
            continue;
          }
        } catch {
          // No evaluator.yaml, continue walking
        }

        await walk(fullPath);
      } else if (isFlatEvaluatorFile(entry)) {
        results.push({
          filePath: fullPath,
          dirPath: dir,
          isDirectoryForm: false,
          category,
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
export async function discoverPatternFiles(evaluatorDir: string): Promise<DiscoveredPattern[]> {
  const patternsDir = path.join(evaluatorDir, "patterns");
  const results: DiscoveredPattern[] = [];

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
 * Discover all suite files in a category.
 */
export async function discoverSuiteFiles(category: EvaluatorCategory): Promise<DiscoveredSuite[]> {
  const baseDir = getSuitesDir(category);
  const results: DiscoveredSuite[] = [];

  try {
    const entries = await readdir(baseDir);
    for (const entry of entries) {
      if (entry.endsWith(".yaml") || entry.endsWith(".yml")) {
        results.push({
          filePath: path.join(baseDir, entry),
          category,
        });
      }
    }
  } catch {
    // Directory doesn't exist
  }

  return results;
}

/**
 * Build an index mapping evaluator IDs to their discovered info.
 */
export async function buildEvaluatorIndex(
  categories: EvaluatorCategory[] = ["agent", "mcp"]
): Promise<Map<string, DiscoveredEvaluator>> {
  const index = new Map<string, DiscoveredEvaluator>();

  for (const category of categories) {
    const evaluators = await discoverEvaluatorFiles(category);
    for (const ev of evaluators) {
      try {
        const content = await readFile(ev.filePath, "utf8");
        const doc = parseYaml(content) as Record<string, unknown>;
        const id = typeof doc.id === "string" ? doc.id.trim() : "";
        if (id) {
          index.set(id, ev);
        }
      } catch {
        // Skip unparseable files
      }
    }
  }

  return index;
}

/**
 * Parse pure YAML file content.
 */
export function parseYamlContent(content: string): unknown {
  return parseYaml(content);
}
