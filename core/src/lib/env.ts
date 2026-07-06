// Pluggable env-var accessor. Default reads process.env, which works for all
// Node consumers (CLI, MCP, tests). Browser consumers (extension) call
// setEnvProvider once at init with a sync function that reads from
// chrome.storage / localStorage / a baked-in map.
//
// Stays synchronous on purpose — engine code reads env values inline (provider
// construction, target factory, telemetry config), and refactoring every call
// site to async would be invasive. Browsers should pre-load values into a
// sync map before any engine call.

import { log } from "./logger.js";

type EnvProvider = (name: string) => string | undefined;

let provider: EnvProvider = (name) =>
  typeof process !== "undefined" && process.env ? process.env[name] : undefined;

export function setEnvProvider(fn: EnvProvider): void {
  provider = fn;
}

export function getEnv(name: string): string | undefined {
  return provider(name);
}

/**
 * Expands `${VAR}` references in header values via the configured env provider.
 * Shared by agent (`target.headers`) and MCP (`target.urlHeaders`) targets so
 * both surfaces resolve secrets the same way.
 */
export function expandEnvInHeaders(headers: Record<string, string>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(headers)) {
    out[k] = v.replace(/\$\{([^}]+)\}/g, (_, name) => {
      const trimmed = name.trim();
      const value = getEnv(trimmed);
      if (value === undefined) {
        log.warn(`header "${k}" references undefined env var "${trimmed}" — sending it as empty.`);
      }
      return value ?? "";
    });
  }
  return out;
}
