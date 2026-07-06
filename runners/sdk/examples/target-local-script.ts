import path from "node:path";
import { fileURLToPath } from "node:url";
import { run } from "@keyvaluesystems/agent-opfor-sdk";
import { startMockLane } from "./_helpers/mockLane.js";

const lane = await startMockLane();
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const scriptPath = path.join(__dirname, "agents", "echo-agent.mjs");

try {
  const results = await run({
    target: {
      type: "local-script",
      name: "Local Echo Agent",
      scriptPath,
    },
    evaluators: ["agent-goal-hijack"],
    strategy: { effort: "adaptive", turns: 1, turnMode: "single" },
    attackerModel: {
      provider: "openai-compatible",
      model: "mock-model",
      apiKey: "fake-test-api-key",
      baseUrl: lane.llmBaseUrl,
    },
    judgeModel: {
      provider: "openai-compatible",
      model: "mock-model",
      apiKey: "fake-test-api-key",
      baseUrl: lane.llmBaseUrl,
    },
  });

  console.log(`score=${results.score} total=${results.summary.total}`);
} finally {
  await lane.close();
}
