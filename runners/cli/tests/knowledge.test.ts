import { test } from "node:test";
import assert from "node:assert/strict";
import { loadKnowledge } from "@keyvaluesystems/agent-opfor-core/autonomous/knowledge/load.js";

test("loadKnowledge loads the bundled seed libraries", async () => {
  const kb = await loadKnowledge();
  assert.ok(kb.vulnClasses.length >= 5, "expected several vuln-class seeds");
  assert.ok(kb.personas.length >= 3, "expected several persona seeds");
  assert.ok(kb.strategies.length >= 3, "expected several strategy seeds");

  // Vuln-class ids are the evaluator *category* ids (evaluators/agent/<id>/README.md),
  // not individual evaluator ids — "injection", not "prompt-injection".
  const injection = kb.vulnClasses.find((v) => v.id === "injection");
  assert.ok(
    injection,
    `injection vuln-class present (got: ${kb.vulnClasses.map((v) => v.id).join(", ")})`
  );
  assert.ok(injection!.failRubric.length > 0, "fail rubric parsed");
  assert.ok(injection!.passRubric.length > 0, "pass rubric parsed");
  assert.equal(injection!.severity, "critical");
});
