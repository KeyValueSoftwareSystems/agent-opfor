import { test } from "node:test";
import assert from "node:assert/strict";
import { loadKnowledge } from "../src/knowledge/load.js";

test("loadKnowledge loads the bundled seed libraries", async () => {
  const kb = await loadKnowledge();
  assert.ok(kb.vulnClasses.length >= 5, "expected several vuln-class seeds");
  assert.ok(kb.personas.length >= 3, "expected several persona seeds");
  assert.ok(kb.strategies.length >= 3, "expected several strategy seeds");

  const injection = kb.vulnClasses.find((v) => v.id === "prompt-injection");
  assert.ok(injection, "prompt-injection vuln-class present");
  assert.ok(injection!.failRubric.length > 0, "fail rubric parsed");
  assert.ok(injection!.passRubric.length > 0, "pass rubric parsed");
  assert.equal(injection!.severity, "critical");
});
