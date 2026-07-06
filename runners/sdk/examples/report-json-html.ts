import { report, run } from "@keyvaluesystems/agent-opfor-sdk";
import { startMockLane } from "./_helpers/mockLane.js";

const lane = await startMockLane();
try {
  const results = await run({
    target: { url: lane.targetUrl, name: "Mock Target" },
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

  const outDir = new URL("./_out/", import.meta.url);
  const htmlPath = new URL("report.html", outDir);
  const jsonPath = new URL("report.json", outDir);

  await report(results).html(htmlPath);
  await report(results).json(jsonPath);

  console.log(`wrote ${htmlPath.pathname}`);
  console.log(`wrote ${jsonPath.pathname}`);
} finally {
  await lane.close();
}
