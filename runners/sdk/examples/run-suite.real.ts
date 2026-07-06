/**
 * Real-provider smoke: attacker + judge via LiteLLM (DeepSeek), target = local vanilla-chat.
 *
 * Prereqs:
 *   1. Start the test agent (from repo root):
 *        cd tests/e2e/agents/vanilla-chat
 *        cp .env.example .env
 *        # PROVIDER=openai, BASE_URL=https://llm.keyvalue.systems/v1, OPENAI_API_KEY=<litellm-key>
 *        npm run dev
 *   2. Export keys:
 *        export LITELLM_BASE_URL=https://llm.keyvalue.systems/v1
 *        export LITELLM_API_KEY=...
 *        export TARGET_URL=http://localhost:4000/chat   # optional default
 *
 * Run from repo root:
 *   node --import tsx/esm runners/sdk/examples/run-suite.real.ts
 */

import { run } from "@keyvaluesystems/agent-opfor-sdk";
import { requireEnv } from "./_helpers/requireEnv.js";

const apiKey = requireEnv("LITELLM_API_KEY");
const baseUrl = requireEnv("LITELLM_BASE_URL").replace(/\/+$/, "");
const targetUrl = process.env.TARGET_URL?.trim() || "http://localhost:4000/chat";
const attackerModel = process.env.OPFOR_ATTACKER_MODEL?.trim() || "deepseek/deepseek-v4-flash";
const judgeModel = process.env.OPFOR_JUDGE_MODEL?.trim() || "deepseek/deepseek-v4-pro";

const llm = (model: string) => ({
  provider: "openai-compatible" as const,
  model,
  apiKey,
  baseUrl,
});

console.log(`target=${targetUrl} llm=${baseUrl} attacker=${attackerModel} judge=${judgeModel}`);

const results = await run({
  target: {
    url: targetUrl,
    name: "Vanilla Chat (local)",
    description: "Express LangChain chat agent from tests/e2e/agents/vanilla-chat",
    requestFormat: "auto",
  },
  evaluators: ["prompt-injection"],
  strategy: { effort: "adaptive", turns: 1, turnMode: "single" },
  attackerModel: llm(attackerModel),
  judgeModel: llm(judgeModel),
});

console.log(
  `done id=${results.id} score=${results.score} passed=${results.summary.passed} failed=${results.summary.failed} errors=${results.summary.errors}`
);

if (results.findings.length > 0) {
  for (const f of results.findings) {
    console.log(`finding [${f.severity}] ${f.title}`);
  }
}
