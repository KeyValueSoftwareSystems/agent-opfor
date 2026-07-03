// Loader for the seed knowledge libraries (YAML-frontmatter .md files).
// Personas and strategies come from the shared `data/` directory; vulnerability
// classes are derived from the evaluator taxonomy (see ./vulnClasses.ts).

import { readFile, readdir, writeFile, mkdir } from "node:fs/promises";
import path from "node:path";
import { parse as parseYaml } from "yaml";
import { getRepoRoot } from "../../config/evaluatorsLayout.js";
import { splitYamlFrontmatter } from "../../util/yamlFrontmatter.js";
import type { KnowledgeBase, Persona, Strategy } from "./types.js";
import { loadVulnClasses } from "./vulnClasses.js";

/**
 * Resolve the seed `data/` directory (personas, strategies). Delegates to
 * `getRepoRoot()` — the same resolver evaluators/suites use — instead of a
 * second, independently-drifting path-candidate list: `data/` is copied into
 * every published package right beside `evaluators/`, so wherever getRepoRoot()
 * anchors on `evaluators/agent`, `data/` is its sibling. Works identically for
 * monorepo dev and bundled CLI/SDK installs.
 *
 * Callers may still pass `seedDir` explicitly to override (personas/strategies only).
 */
function defaultSeedDir(): string {
  return path.join(getRepoRoot(), "data");
}

async function readMdDir(dir: string): Promise<Array<Record<string, unknown>>> {
  let entries: string[];
  try {
    entries = (await readdir(dir)).filter((f) => f.endsWith(".md"));
  } catch {
    return [];
  }
  const docs: Array<Record<string, unknown>> = [];
  for (const file of entries.sort()) {
    const raw = await readFile(path.join(dir, file), "utf8");
    const split = splitYamlFrontmatter(raw);
    if (!split) continue;
    let doc: unknown;
    try {
      doc = parseYaml(split.yaml);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      throw new Error(`Invalid YAML frontmatter in ${path.join(dir, file)}: ${msg}`, {
        cause: err,
      });
    }
    if (doc && typeof doc === "object") {
      docs.push(doc as Record<string, unknown>);
    }
  }
  return docs;
}

function str(v: unknown, fallback = ""): string {
  return typeof v === "string" ? v.trim() : fallback;
}

function toPersona(d: Record<string, unknown>): Persona | null {
  const id = str(d.id);
  if (!id) return null;
  return {
    id,
    name: str(d.name, id),
    voice: str(d.voice),
    traits: str(d.traits),
    whenToUse: str(d.when_to_use),
  };
}

function toStrategy(d: Record<string, unknown>): Strategy | null {
  const id = str(d.id);
  if (!id) return null;
  return {
    id,
    name: str(d.name, id),
    mechanics: str(d.mechanics),
    whenToUse: str(d.when_to_use),
    escalationNotes: str(d.escalation_notes),
  };
}

/**
 * Load all seed knowledge libraries. Personas/strategies are read from `seedDir`
 * (or the default shared `data/` dir); vulnerability classes are always derived
 * from the evaluator taxonomy and are not affected by `seedDir`.
 */
export async function loadKnowledge(seedDir?: string): Promise<KnowledgeBase> {
  const base = seedDir ? path.resolve(seedDir) : defaultSeedDir();
  const [vulnClasses, personaDocs, strategyDocs] = await Promise.all([
    loadVulnClasses(),
    readMdDir(path.join(base, "personas")),
    readMdDir(path.join(base, "strategies")),
  ]);
  return {
    vulnClasses,
    personas: personaDocs.map(toPersona).filter((p): p is Persona => p !== null),
    strategies: strategyDocs.map(toStrategy).filter((s): s is Strategy => s !== null),
  };
}

/** Resolve the on-disk directory for a given knowledge kind (for persisting inventions). */
export function seedSubdir(kind: "persona" | "strategy", seedDir?: string): string {
  const base = seedDir ? path.resolve(seedDir) : defaultSeedDir();
  const sub = kind === "persona" ? "personas" : "strategies";
  return path.join(base, sub);
}

/** Persist a novel persona or strategy back to the seed library as a new .md file. */
export async function persistInvention(
  kind: "persona" | "strategy",
  invention: { id: string; name: string; description: string },
  seedDir?: string
): Promise<string> {
  const dir = seedSubdir(kind, seedDir);
  await mkdir(dir, { recursive: true });
  const safeId = invention.id.replace(/[^a-z0-9-]/gi, "-").toLowerCase();
  const file = path.join(dir, `${safeId}.md`);
  const fields =
    kind === "persona"
      ? `voice: |-\n  ${invention.description}\ntraits: |-\n  (invented during an autonomous run)\nwhen_to_use: |-\n  ${invention.description}`
      : `mechanics: |-\n  ${invention.description}\nwhen_to_use: |-\n  (invented during an autonomous run)\nescalation_notes: |-\n  ${invention.description}`;
  const content = `---\nid: ${safeId}\nname: ${JSON.stringify(invention.name)}\norigin: autonomous-invention\n${fields}\n---\n\n${invention.description}\n`;
  await writeFile(file, content, "utf8");
  return file;
}
