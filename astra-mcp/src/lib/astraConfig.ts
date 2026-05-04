import path from "node:path";
import { fileExists } from "./jsonFile.js";
import { log } from "./logger.js";

/** Default config filename written by `astra-mcp init`. */
export const DEFAULT_ASTRA_MCP_CONFIG = "astra-mcp.config.json";

export function resolveAstraMcpConfigPath(explicit?: string): string {
  return path.resolve(explicit ?? DEFAULT_ASTRA_MCP_CONFIG);
}

/**
 * Ensures an astra-mcp config file exists. If missing, logs and exits.
 * @returns absolute path to the config file
 */
export async function requireAstraMcpConfig(explicit?: string): Promise<string> {
  const configPath = resolveAstraMcpConfigPath(explicit);
  if (!(await fileExists(configPath))) {
    log.error(`No config found at ${configPath}.`);
    log.info("Run `astra-mcp init` first to create astra-mcp.config.json.");
    process.exit(1);
  }
  return configPath;
}
