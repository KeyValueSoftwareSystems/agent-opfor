import path from "node:path";
import { readFile } from "node:fs/promises";
import { parse as parseYaml } from "yaml";
import type { AstraMcpConfig } from "../config/schema.js";
import { extractMcpScannerConfig } from "../config/schema.js";

export async function loadAstraMcpConfigFile(configPath: string): Promise<AstraMcpConfig> {
  const raw = await readFile(configPath, "utf8");
  const ext = path.extname(configPath).toLowerCase();
  const json: unknown =
    ext === ".yml" || ext === ".yaml" ? parseYaml(raw) : JSON.parse(raw);
  try {
    return extractMcpScannerConfig(json);
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    throw new Error(`Invalid astra.config.json: ${msg}`, { cause: err });
  }
}
