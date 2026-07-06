import { run } from "@keyvaluesystems/agent-opfor-sdk";
import type { ProgressEvent, RunListener } from "@keyvaluesystems/agent-opfor-sdk";
import { startMockLane } from "./_helpers/mockLane.js";

const lane = await startMockLane();

const listener: RunListener = {
  onRunStart: (info) => console.log(`onRunStart evaluatorCount=${info.evaluatorCount}`),
  onEvaluatorStart: (e) => console.log(`onEvaluatorStart ${e.evaluatorId}`),
  onAttackDone: (e) => console.log(`onAttackDone ${e.attackId} verdict=${e.verdict}`),
  onRunFinish: (results) => console.log(`onRunFinish score=${results.score}`),
  onRunError: ({ error }) => console.error("onRunError", error),
};

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
    onProgress: (event: ProgressEvent) => {
      if (event.type === "evaluator_start")
        console.log(`progress evaluator_start ${event.evaluatorId}`);
      if (event.type === "evaluator_done")
        console.log(
          `progress evaluator_done ${event.evaluatorId} passed=${event.passed} failed=${event.failed} errors=${event.errors}`
        );
    },
    listeners: [listener],
  });

  console.log(`done total=${results.summary.total} findings=${results.findings.length}`);
} finally {
  await lane.close();
}
