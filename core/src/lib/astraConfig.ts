import path from "node:path";
import { fileExists } from "./jsonFile.js";
import { log } from "./logger.js";

/** Unified config filename (contains optional `mcp` + `agent` sections). */
export const DEFAULT_ASTRA_CONFIG = "astra.config.json";

export function resolveAstraConfigPath(explicit?: string): string {
  return path.resolve(explicit ?? DEFAULT_ASTRA_CONFIG);
}

/**
 * Ensures the unified config file exists. If missing, logs and exits.
 * @returns absolute path to the config file
 */
export async function requireAstraMcpConfig(explicit?: string): Promise<string> {
  const configPath = resolveAstraConfigPath(explicit);
  if (!(await fileExists(configPath))) {
    log.error(`No config found at ${configPath}.`);
    log.info('Run `astra setup --mcp` first to create a config with an "mcp" section.');
    process.exit(1);
  }
  return configPath;
}
