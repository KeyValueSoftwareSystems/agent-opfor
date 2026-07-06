import { Opfor } from "@keyvaluesystems/agent-opfor-sdk";
import { startMockLane } from "./_helpers/mockLane.js";

const lane = await startMockLane();
try {
  const opfor = new Opfor({
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

  const results = await opfor.run({
    target: { url: lane.targetUrl, name: "Mock Target" },
    evaluators: ["agent-goal-hijack"],
    strategy: { effort: "adaptive", turns: 1, turnMode: "single" },
  });

  console.log(`score=${results.score} findings=${results.findings.length}`);
} finally {
  await lane.close();
}
