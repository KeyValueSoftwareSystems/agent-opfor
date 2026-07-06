// HTTP client for the target agent under test.
// Delegates to core's shared httpClient for the actual HTTP work.

import {
  httpSend,
  resolveSessionPlan,
  type HttpTargetConfig,
  type HttpTargetMessage,
  type HttpSendResult,
} from "../../targets/httpClient.js";
import type { TargetConfig } from "../lib/types.js";
import { log } from "../../lib/logger.js";

export type { HttpTargetMessage as TargetMessage };
export type { HttpSendResult as TargetSendResult };

export interface TargetSendOptions {
  threadId: string;
  history: HttpTargetMessage[];
}

export interface TargetClient {
  send(prompt: string, options: TargetSendOptions): Promise<HttpSendResult>;
}

function toHttpConfig(config: TargetConfig): HttpTargetConfig {
  return {
    endpoint: config.endpoint,
    apiKey: config.apiKey,
    headers: config.headers,
    mode: config.mode,
    promptPath: config.promptPath,
    responsePath: config.responsePath,
    sessionField: config.sessionField,
    session: config.session,
    model: config.model,
  };
}

export function createTargetClient(config: TargetConfig): TargetClient {
  const httpConfig = toHttpConfig(config);
  const plan = resolveSessionPlan(httpConfig);
  // Server-owned targets mint their own id, so threadId can't be the wire id.
  // Keep the returned id per threadId and echo it on that thread's later turns.
  const serverSessions = new Map<string, string>();
  let warnedCaptureMiss = false;

  return {
    async send(prompt: string, options: TargetSendOptions): Promise<HttpSendResult> {
      const wireSessionId =
        plan.mode === "server" ? serverSessions.get(options.threadId) : options.threadId;
      const result = await httpSend(httpConfig, prompt, {
        history: options.history,
        sessionId: wireSessionId,
      });
      if (plan.mode === "server") {
        if (result.sessionId) {
          serverSessions.set(options.threadId, result.sessionId);
        } else if (!warnedCaptureMiss) {
          warnedCaptureMiss = true;
          log.warn(
            `server-owned target never returned a session id (session.receive: ${plan.receive?.in}` +
              `${plan.receive?.name ? ` "${plan.receive.name}"` : ""}). ` +
              `Check that the target actually returns one at that location, and that its response format ` +
              `matches responsePath. Threads will keep sending no session id until it does.`
          );
        }
      }
      return result;
    },
  };
}
