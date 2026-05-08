import path from "node:path";
import { readFile } from "node:fs/promises";
import { parse as parseYaml } from "yaml";

export type UnifiedMode = "mcp" | "agent";

export interface UnifiedConfigFileV1 {
  configId: string;
  createdAt: string;
  mode?: UnifiedMode | "both";
  mcp?: Record<string, unknown>;
  agent?: Record<string, unknown>;
}

export async function loadUnifiedConfigFile(configPath: string): Promise<UnifiedConfigFileV1> {
  const raw = await readFile(path.resolve(configPath), "utf8");
  const ext = path.extname(configPath).toLowerCase();
  const parsed: unknown = ext === ".yml" || ext === ".yaml" ? parseYaml(raw) : JSON.parse(raw);

  if (parsed === null || typeof parsed !== "object") {
    throw new Error("Invalid config file");
  }
  const o = parsed as Record<string, unknown>;
  if (typeof o.configId !== "string" || o.configId.trim() === "") {
    throw new Error("Not a valid astra config file (missing configId). Run `astra setup`.");
  }
  if (typeof o.createdAt !== "string" || o.createdAt.trim() === "") {
    throw new Error("Missing createdAt in config (expected astra setup output)");
  }

  return o as unknown as UnifiedConfigFileV1;
}
