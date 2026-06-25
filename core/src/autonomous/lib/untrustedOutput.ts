// Single source of truth for the "untrusted target output" delimiters and the
// helper that wraps a target reply in them before it is handed to an agent.
// Keeping the tag here (instead of re-typing the literal in each tool) means the
// wrapping code and the prompt copy that tells the agent about the tag
// (ADVERSARIAL_TARGET_DEFENSE) can never drift apart.

export const UNTRUSTED_OPEN = "<untrusted_target_output>";
export const UNTRUSTED_CLOSE = "</untrusted_target_output>";

/**
 * Wrap a successful target response in untrusted-data delimiters to reinforce to
 * the agent that target content is DATA, not instructions — a defense against
 * adversarial targets attempting prompt injection on the hunt agent. Error and
 * rate-limited responses are returned unchanged so failure handling is unaffected.
 */
export function wrapUntrustedOutput(
  response: string | undefined,
  flags: { isError?: boolean; rateLimited?: boolean } = {}
): string | undefined {
  if (!response || flags.isError || flags.rateLimited) return response;
  return `${UNTRUSTED_OPEN}\n${response}\n${UNTRUSTED_CLOSE}`;
}
