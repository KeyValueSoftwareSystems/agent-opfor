import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parse as parseYaml } from "yaml";

export interface AtlasTechniqueMeta {
  id: string;
  name: string;
  tactics?: string[];
}

interface AtlasYamlTechnique {
  id?: string;
  name?: string;
  tactics?: unknown[];
}

interface AtlasYamlMatrix {
  techniques?: AtlasYamlTechnique[];
}

interface AtlasYamlDoc {
  matrices?: AtlasYamlMatrix[];
}

function repoRootFromHere(): string {
  const here = path.dirname(fileURLToPath(import.meta.url));
  // core/src/standards -> repo root
  return path.resolve(here, "..", "..", "..");
}

function atlasYamlPath(): string {
  return path.join(repoRootFromHere(), "third_party", "atlas-data", "dist", "ATLAS.yaml");
}

function missingSubmoduleHelp(atlasPath: string): string {
  return [
    `MITRE ATLAS submodule not found at ${atlasPath}.`,
    "",
    "Initialize submodules with:",
    "  git submodule update --init --recursive",
  ].join("\n");
}

/**
 * Load a map of ATLAS technique ID -> metadata (name, tactics).
 *
 * Source of truth: `third_party/atlas-data/dist/ATLAS.yaml` (vendored as a git submodule).
 */
export async function loadAtlasTechniqueIndex(): Promise<Map<string, AtlasTechniqueMeta>> {
  const atlasPath = atlasYamlPath();
  let raw: string;
  try {
    raw = await readFile(atlasPath, "utf8");
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    throw new Error(`${missingSubmoduleHelp(atlasPath)}\n\nUnderlying error: ${msg}`, { cause: e });
  }

  const doc = parseYaml(raw) as AtlasYamlDoc;
  const matrices = Array.isArray(doc?.matrices) ? doc.matrices : [];
  const matrix = matrices[0];
  const techniques = Array.isArray(matrix?.techniques) ? matrix.techniques : [];

  const out = new Map<string, AtlasTechniqueMeta>();
  for (const t of techniques) {
    const id = typeof t?.id === "string" ? t.id.trim() : "";
    if (!id) continue;
    const name = typeof t?.name === "string" ? t.name.trim() : "";
    if (!name) continue;
    const tactics = Array.isArray(t?.tactics)
      ? t.tactics
          .filter((x): x is string => typeof x === "string" && Boolean(x.trim()))
          .map((x) => x.trim())
      : undefined;
    out.set(id, { id, name, ...(tactics?.length ? { tactics } : {}) });
  }
  return out;
}

/** Convenience: a Set of all valid ATLAS technique IDs (including sub-techniques). */
export async function loadAtlasTechniqueIdSet(): Promise<Set<string>> {
  return new Set((await loadAtlasTechniqueIndex()).keys());
}
