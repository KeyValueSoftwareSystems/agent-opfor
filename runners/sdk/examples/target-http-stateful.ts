import { run } from "@keyvaluesystems/agent-opfor-sdk";
import { startMockLane } from "./_helpers/mockLane.js";

const lane = await startMockLane();
try {
  const results = await run({
    target: {
      url: lane.targetUrl,
      name: "Mock Target (stateful session)",
      stateful: true,
      sessionField: "session_id",
    },
    evaluators: ["agent-goal-hijack"],
    strategy: { effort: "adaptive", turns: 2, turnMode: "multi" },
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
