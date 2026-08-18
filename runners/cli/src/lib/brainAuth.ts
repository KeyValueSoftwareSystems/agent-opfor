// Which credential the hunt agents (commander / operator / scout / verifier) authenticate with.
// Shared by the CLI's startup precheck (hunt.ts) and the setup server's /api/brain-auth +
// override handling (ui/server.ts) — kept in its own module so neither has to import the other.
//
// Hunt now runs on the same provider registry as `opfor run`, so this is a plain
// "is the provider's key present?" check. It previously also accepted a Claude subscription
// (`claude login` / `claude setup-token`); that only worked because the Claude Agent SDK
// spawned the Claude Code CLI, which no longer happens. See docs/hunt.md#authentication.

import {
  PROVIDERS,
  PROVIDER_ENV_VARS,
  PROVIDER_DISPLAY_NAMES,
  type ProviderName,
} from "@keyvaluesystems/agent-opfor-core/providers/factory.js";
import type { BrainConfig } from "@keyvaluesystems/agent-opfor-core/autonomous/lib/models.js";

/** Every valid `--brain-provider` value, for validation and help text. */
export const BRAIN_PROVIDERS: ProviderName[] = Object.values(PROVIDERS);

/**
 * Human-readable credential source, e.g. "GROQ_API_KEY". Never a secret value.
 * `warning` is set when a configured credential looks incomplete.
 */
export interface BrainAuthInfo {
  method: string;
  warning?: string;
}

/** CLI option subset this module reads. */
export interface BrainCliOptions {
  brainProvider?: string;
  brainKeyEnv?: string;
  brainBaseUrl?: string;
}

/** Validate + normalize the brain provider flags into a BrainConfig. */
export function resolveBrainConfig(opts: BrainCliOptions): BrainConfig {
  const provider = (opts.brainProvider ?? "anthropic") as ProviderName;
  if (!BRAIN_PROVIDERS.includes(provider)) {
    throw new Error(
      `Unknown --brain-provider "${opts.brainProvider}". Use one of: ${BRAIN_PROVIDERS.join(", ")}.`
    );
  }
  return {
    provider,
    apiKeyEnv: opts.brainKeyEnv?.trim() || undefined,
    baseURL: opts.brainBaseUrl?.trim() || undefined,
  };
}

/** The env var this brain config will read its key from. */
export function brainKeyEnvVar(brain: BrainConfig): string {
  return brain.apiKeyEnv ?? PROVIDER_ENV_VARS[brain.provider];
}

/**
 * Resolve the credential the brain agents will authenticate with, for a user-facing log line —
 * or null if none is configured.
 */
export function resolveBrainAuth(brain: BrainConfig): BrainAuthInfo | null {
  const envVar = brainKeyEnvVar(brain);
  if (!process.env[envVar]?.trim()) return null;

  const label = PROVIDER_DISPLAY_NAMES[brain.provider] ?? brain.provider;
  return {
    method: brain.baseURL ? `${envVar} → gateway (${label})` : `${envVar} (${label})`,
  };
}

/** The error printed when resolveBrainAuth() finds nothing. */
export function noBrainAuthMessage(brain: BrainConfig): string {
  const envVar = brainKeyEnvVar(brain);
  return (
    `No API key found for the hunt agents. Set ${envVar} for provider "${brain.provider}", ` +
    `or pick another with --brain-provider (${BRAIN_PROVIDERS.join(", ")}).`
  );
}
