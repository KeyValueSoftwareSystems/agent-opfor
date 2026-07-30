// Which credential the Claude Agent SDK will authenticate the commander/operator/
// scout agents with. Shared by the CLI's startup precheck (hunt.ts) and the setup
// server's /api/brain-auth + override handling (ui/server.ts) — kept in its own
// module so neither has to import the other.

import { existsSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";

/**
 * Human-readable credential source, e.g. "ANTHROPIC_API_KEY". Never a secret value.
 * `warning` is set when a configured credential was silently ignored (see below).
 */
export interface BrainAuthInfo {
  method: string;
  warning?: string;
}

const NO_BRAIN_AUTH_MESSAGE =
  "No Claude credentials found. Set ANTHROPIC_API_KEY, or run `claude login` / `claude setup-token` to use a Claude subscription.";

const ORPHAN_GATEWAY_TOKEN_WARNING =
  "ANTHROPIC_AUTH_TOKEN is set but ANTHROPIC_BASE_URL is not — the token is ignored and the run " +
  "falls back to the next credential. Set both together to route through a gateway.";

/** True when ANTHROPIC_AUTH_TOKEN is set but its required pair, ANTHROPIC_BASE_URL, is not. */
function hasOrphanedGatewayToken(): boolean {
  return Boolean(
    process.env.ANTHROPIC_AUTH_TOKEN?.trim() && !process.env.ANTHROPIC_BASE_URL?.trim()
  );
}

/**
 * Resolve which credential the Claude Agent SDK will authenticate with, for a
 * user-facing log line — or null if none is configured.
 *
 * The SDK resolves credentials itself (first match wins): ANTHROPIC_API_KEY →
 * CLAUDE_CODE_OAUTH_TOKEN → a stored `~/.claude/.credentials.json` from a Claude
 * subscription login (`claude setup-token` / `claude login`). This is a courtesy
 * pre-check so we can emit an actionable message instead of a cryptic SDK error;
 * it must therefore recognize the subscription path, not just env vars.
 */
export function resolveBrainAuth(): BrainAuthInfo | null {
  // A gateway token without its base URL is stripped by buildChildEnv(), so the run
  // silently proceeds on a *different* credential — e.g. billing a personal Claude
  // subscription instead of the intended gateway. Surface that rather than let it pass.
  const warning = hasOrphanedGatewayToken() ? ORPHAN_GATEWAY_TOKEN_WARNING : undefined;

  if (process.env.ANTHROPIC_API_KEY?.trim()) return { method: "ANTHROPIC_API_KEY", warning };
  // ANTHROPIC_AUTH_TOKEN only counts alongside ANTHROPIC_BASE_URL: buildChildEnv()
  // strips a bare token (it's treated as an inherited session token), so counting
  // it here without a gateway URL would pass the gate then lose the credential.
  if (process.env.ANTHROPIC_AUTH_TOKEN?.trim() && process.env.ANTHROPIC_BASE_URL?.trim()) {
    // Never interpolate the actual URL: it may carry userinfo or a signed query
    // string, and this label is rendered in the setup UI, not just the terminal.
    return { method: "gateway (ANTHROPIC_BASE_URL)" };
  }
  if (process.env.CLAUDE_CODE_OAUTH_TOKEN?.trim()) {
    return { method: "CLAUDE_CODE_OAUTH_TOKEN", warning };
  }
  // Claude subscription: credentials stored on disk by `claude setup-token` / `claude login`.
  if (existsSync(path.join(homedir(), ".claude", ".credentials.json"))) {
    return { method: "Claude subscription (~/.claude/.credentials.json)", warning };
  }
  return null;
}

/**
 * The error printed when resolveBrainAuth() finds nothing. Special-cased for the
 * orphaned-gateway-token footgun — otherwise a user who DID set ANTHROPIC_AUTH_TOKEN
 * sees "no credentials found" with no hint that what they configured was silently
 * discarded for missing its required ANTHROPIC_BASE_URL pair.
 */
export function noBrainAuthMessage(): string {
  if (hasOrphanedGatewayToken()) {
    return (
      "ANTHROPIC_AUTH_TOKEN is set but ANTHROPIC_BASE_URL is not, so it was ignored, and no " +
      "other Claude credential was found. Set ANTHROPIC_BASE_URL alongside it, or set " +
      "ANTHROPIC_API_KEY, or run `claude login` / `claude setup-token`."
    );
  }
  return NO_BRAIN_AUTH_MESSAGE;
}
