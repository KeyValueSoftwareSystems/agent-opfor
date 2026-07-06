import { listEvaluators, listSuites } from "@keyvaluesystems/agent-opfor-sdk";

const suites = await listSuites();
console.log(`suites=${suites.length}`);
console.log(
  suites
    .slice(0, 5)
    .map((s) => s.id)
    .join(", ")
);

const agentEvaluators = await listEvaluators({ kind: "agent" });
console.log(`agentEvaluators=${agentEvaluators.length}`);

const mcpEvaluators = await listEvaluators({ kind: "mcp" });
console.log(`mcpEvaluators=${mcpEvaluators.length}`);
