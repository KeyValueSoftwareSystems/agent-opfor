// HTTP client for the target agent under test.
// Delegates to core's shared httpClient for the actual HTTP work.

import {
  httpSend,
  type HttpTargetConfig,
  type HttpTargetMessage,
  type HttpSendResult,
} from "../../targets/httpClient.js";
import type { TargetConfig } from "../lib/types.js";

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
    targetModel: config.targetModel,
  };
}

export function createTargetClient(config: TargetConfig): TargetClient {
  const httpConfig = toHttpConfig(config);

  return {
    async send(prompt: string, options: TargetSendOptions): Promise<HttpSendResult> {
      return httpSend(httpConfig, prompt, {
        history: options.history,
        sessionId: options.threadId,
      });
    },
  };
}
