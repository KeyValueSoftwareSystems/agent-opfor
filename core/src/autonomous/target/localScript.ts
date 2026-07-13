// Local-script target client for `opfor hunt` — same TargetClient interface as
// the HTTP client (./http.ts), but shells out to a user script per turn instead
// of making an HTTP request. Shares the stdin/stdout contract documented for
// `opfor run`'s local-script targets (see core/src/lib/localScriptTarget.ts).

import { invokeLocalTargetScript } from "../../lib/localScriptTarget.js";
import { isTargetError, RATE_LIMITED_SENTINEL } from "../../targets/agentTarget.js";
import type { HttpSendResult } from "../../targets/httpClient.js";
import type { TargetConfig } from "../lib/types.js";
import type { TargetClient, TargetSendOptions } from "./http.js";

export function createLocalScriptTargetClient(config: TargetConfig): TargetClient {
  if (!config.scriptPath) {
    throw new Error("local-script target is missing `scriptPath`.");
  }
  const scriptPath = config.scriptPath;

  return {
    async send(prompt: string, options: TargetSendOptions): Promise<HttpSendResult> {
      // The script owns its own conversation history/session, keyed by sessionId
      // (same contract `opfor run` uses). threadId doubles as that session id, so
      // hunt's per-thread forking works for free: each forked thread gets its own
      // threadId and the script sees it as a distinct session.
      const response = await invokeLocalTargetScript(scriptPath, {
        prompt,
        sessionId: options.threadId,
      });
      const isError = isTargetError(response);
      return {
        response,
        isError,
        rateLimited: response === RATE_LIMITED_SENTINEL,
        errorMessage: isError ? response : undefined,
      };
    },
  };
}
