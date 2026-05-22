// Pluggable env-var accessor. Default reads process.env, which works for all
// Node consumers (CLI, MCP, tests). Browser consumers (extension) call
// setEnvProvider once at init with a sync function that reads from
// chrome.storage / localStorage / a baked-in map.
//
// Stays synchronous on purpose — engine code reads env values inline (provider
// construction, target factory, telemetry config), and refactoring every call
// site to async would be invasive. Browsers should pre-load values into a
// sync map before any engine call.

type EnvProvider = (name: string) => string | undefined;

let provider: EnvProvider = (name) =>
  typeof process !== "undefined" && process.env ? process.env[name] : undefined;

export function setEnvProvider(fn: EnvProvider): void {
  provider = fn;
}

export function getEnv(name: string): string | undefined {
  return provider(name);
}
