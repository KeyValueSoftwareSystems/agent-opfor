import { run } from "@keyvaluesystems/agent-opfor-sdk";
import { startMockLane } from "./_helpers/mockLane.js";

const lane = await startMockLane();
try {
  const results = await run({
    target: { url: lane.targetUrl, name: "Mock Target" },
    suite: "quick-smoke",
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

  if (results.findings.length > 0) {
    console.error(`${results.findings.length} finding(s) detected`);
    for (const f of results.findings) console.error(`- [${f.severity}] ${f.title}`);
    process.exitCode = 1;
  } else {
    console.log(`OK score=${results.score} total=${results.summary.total}`);
  }
} finally {
  await lane.close();
}
