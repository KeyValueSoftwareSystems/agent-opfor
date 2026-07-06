import { run } from "@keyvaluesystems/agent-opfor-sdk";
import { startMockLane } from "./_helpers/mockLane.js";

const lane = await startMockLane();
try {
  const results = await run({
    target: { url: lane.targetUrl, name: "Mock Target" },
    evaluators: ["agent-goal-hijack"],
    strategy: {
      effort: "comprehensive",
      turnMode: "multi",
      turns: 3,
    },
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

  console.log(
    `total=${results.summary.total} passed=${results.summary.passed} errors=${results.summary.errors}`
  );
} finally {
  await lane.close();
}
