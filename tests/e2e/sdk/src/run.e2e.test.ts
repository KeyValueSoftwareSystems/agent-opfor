import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { run } from "@keyvaluesystems/agent-opfor-sdk";
import type { RunListener, RunResults, ProgressEvent } from "@keyvaluesystems/agent-opfor-sdk";
import {
  startMockServer,
  buildMockRunOptions,
  type MockServerState,
} from "./helpers/mockServer.js";

describe("SDK e2e — run()", () => {
  let mock: MockServerState;

  before(async () => {
    mock = await startMockServer({ judgeVerdict: "PASS" });
  });

  after(() => {
    mock.server.close();
  });

  it("happy path: run() returns RunResults with expected shape", async () => {
    mock.reset();
    const results = await run(buildMockRunOptions(mock));

    assert.equal(typeof results.id, "string");
    assert.ok(results.id.length > 0);
    assert.equal(typeof results.timestamp, "string");
    assert.equal(results.targetName, "E2E Mock Target");
    assert.equal(results.targetKind, "agent");
    assert.equal(results.effort, "adaptive");
    assert.equal(typeof results.score, "number");
    assert.ok(results.score >= 0 && results.score <= 100);

    assert.equal(typeof results.summary, "object");
    assert.equal(typeof results.summary.total, "number");
    assert.ok(results.summary.total >= 1);
    assert.equal(typeof results.summary.passed, "number");
    assert.equal(typeof results.summary.failed, "number");
    assert.equal(typeof results.summary.errors, "number");
    assert.equal(typeof results.summary.safetyScore, "number");

    assert.ok(Array.isArray(results.evaluators));
    assert.ok(results.evaluators.length >= 1);
    const ev = results.evaluators[0];
    assert.equal(ev.evaluatorId, "agent-goal-hijack");
    assert.ok(Array.isArray(ev.attacks));
    assert.ok(ev.attacks.length >= 1);

    assert.ok(Array.isArray(results.findings));
    // PASS verdict → no findings
    assert.equal(results.findings.length, 0);

    assert.ok(mock.targetCallCount >= 1);
    assert.ok(mock.llmCallCount >= 2); // attacker + judge
    assert.ok(mock.judgeCallCount >= 1);
  });

  it("emits progress events for evaluator_start and evaluator_done", async () => {
    mock.reset();
    const events: ProgressEvent[] = [];

    await run(
      buildMockRunOptions(mock, {
        onProgress: (event) => events.push(event),
      })
    );

    const types = events.map((e) => e.type);
    assert.ok(types.includes("evaluator_start"), `got: ${types.join(", ")}`);
    assert.ok(types.includes("evaluator_done"), `got: ${types.join(", ")}`);

    const start = events.find((e) => e.type === "evaluator_start");
    assert.equal(start?.evaluatorId, "agent-goal-hijack");

    const done = events.find((e) => e.type === "evaluator_done");
    assert.equal(done?.evaluatorId, "agent-goal-hijack");
    assert.equal(typeof done?.passed, "number");
    assert.equal(typeof done?.failed, "number");
    assert.equal(typeof done?.errors, "number");
  });

  it("RunListener lifecycle hooks receive RunResults on onRunFinish", async () => {
    mock.reset();

    let runStartCalled = false;
    let attackDoneCalled = false;
    let runFinishResults: RunResults | undefined;

    const listener: RunListener = {
      onRunStart: (info) => {
        runStartCalled = true;
        assert.equal(typeof info.evaluatorCount, "number");
        assert.ok(info.evaluatorCount >= 1);
      },
      onAttackDone: (info) => {
        attackDoneCalled = true;
        assert.equal(typeof info.attackId, "string");
        assert.ok(["PASS", "FAIL", "ERROR"].includes(info.verdict));
      },
      onRunFinish: (results) => {
        runFinishResults = results;
      },
    };

    await run(
      buildMockRunOptions(mock, {
        listeners: [listener],
      })
    );

    assert.equal(runStartCalled, true);
    assert.equal(attackDoneCalled, true);
    assert.ok(runFinishResults);
    assert.equal(runFinishResults!.targetName, "E2E Mock Target");
    assert.equal(typeof runFinishResults!.score, "number");
    assert.ok(Array.isArray(runFinishResults!.evaluators));
  });
});

describe("SDK e2e — error lane", () => {
  let mock: MockServerState;

  before(async () => {
    mock = await startMockServer({ targetMode: "error" });
  });

  after(() => {
    mock.server.close();
  });

  it("surfaces target failure as ERROR verdict without throwing", async () => {
    mock.reset();
    const events: ProgressEvent[] = [];
    let runStopped = false;
    let runFinishResults: RunResults | undefined;

    const listener: RunListener = {
      onRunStopped: () => {
        runStopped = true;
      },
      onRunFinish: (results) => {
        runFinishResults = results;
      },
    };

    const results = await run(
      buildMockRunOptions(mock, {
        onProgress: (event) => events.push(event),
        listeners: [listener],
      })
    );

    // Run completes with a partial report rather than throwing.
    assert.ok(results);
    assert.ok(results.summary.errors >= 1 || runStopped);

    const attackDone = events.filter((e) => e.type === "attack_done");
    assert.ok(attackDone.length >= 1);
    const hasError = attackDone.some((e) => e.type === "attack_done" && e.verdict === "ERROR");
    assert.equal(hasError, true);

    assert.ok(runFinishResults);
    assert.ok(runFinishResults!.summary.errors >= 1);
  });
});
