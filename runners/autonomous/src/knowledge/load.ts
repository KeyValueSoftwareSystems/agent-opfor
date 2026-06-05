// Loader for the seed knowledge libraries (YAML-frontmatter .md files).
// Standalone: no @opfor/core import. Resolves the bundled `data/` directory
// relative to this module so it works regardless of the caller's cwd.

import { readFile, readdir, writeFile, mkdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parse as parseYaml } from "yaml";
import type { KnowledgeBase, VulnClass, Persona, Strategy, KnowledgeKind } from "./types.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/**
 * Resolve the seed data directory. At runtime this module lives in
 * `dist/knowledge/load.js`, so the bundled seeds are at `../../data`
 * (the `data/` dir is shipped via package.json `files`).
 */
function defaultSeedDir(): string {
  return path.resolve(__dirname, "../../data");
}

/** Split a markdown file into YAML frontmatter + body. */
function splitFrontmatter(raw: string): { yaml: string; body: string } | null {
  const match = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/.exec(raw);
  if (!match) return null;
  return { yaml: match[1], body: match[2] ?? "" };
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
    const split = splitFrontmatter(raw);
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

function toVulnClass(d: Record<string, unknown>): VulnClass | null {
  const id = str(d.id);
  if (!id) return null;
  const severity = str(d.severity, "medium") as VulnClass["severity"];
  return {
    id,
    name: str(d.name, id),
    severity: ["critical", "high", "medium", "low"].includes(severity) ? severity : "medium",
    standards:
      d.standards && typeof d.standards === "object"
        ? (d.standards as Record<string, string>)
        : undefined,
    description: str(d.description),
    failRubric: str(d.fail_rubric),
    passRubric: str(d.pass_rubric),
    inspiration: str(d.inspiration) || undefined,
  };
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

/** Load all seed knowledge libraries. */
export async function loadKnowledge(seedDir?: string): Promise<KnowledgeBase> {
  const base = seedDir ? path.resolve(seedDir) : defaultSeedDir();
  const [vulnDocs, personaDocs, strategyDocs] = await Promise.all([
    readMdDir(path.join(base, "vuln-classes")),
    readMdDir(path.join(base, "personas")),
    readMdDir(path.join(base, "strategies")),
  ]);
  return {
    vulnClasses: vulnDocs.map(toVulnClass).filter((v): v is VulnClass => v !== null),
    personas: personaDocs.map(toPersona).filter((p): p is Persona => p !== null),
    strategies: strategyDocs.map(toStrategy).filter((s): s is Strategy => s !== null),
  };
}

/** Resolve the on-disk directory for a given knowledge kind (for persisting inventions). */
export function seedSubdir(kind: KnowledgeKind, seedDir?: string): string {
  const base = seedDir ? path.resolve(seedDir) : defaultSeedDir();
  const sub = kind === "persona" ? "personas" : kind === "strategy" ? "strategies" : "vuln-classes";
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
