/**
 * PR8 — AttackRunner (Template Method) contract.
 *
 * Pins the invariant skeleton every attack kind shares: per turn build → execute
 * → record → shouldEarlyStop, in that order; early-stop breaks the loop; finalize
 * runs once at the end and its result is returned; turns run from startTurn to
 * totalTurns inclusive.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { runAttack, type AttackDriver } from "../src/execute/attackRunner.js";
import type { AttackResult } from "../src/execute/types.js";

const RESULT = { kind: "agent", attackId: "a", evaluatorId: "e", patternName: "p" } as AttackResult;

/** Records the exact call order and turn numbers for assertions. */
function trackingDriver(opts: {
  startTurn: number;
  totalTurns: number;
  stopAfter?: number;
}): AttackDriver<string, string> & { calls: string[] } {
  const calls: string[] = [];
  return {
    calls,
    startTurn: opts.startTurn,
    totalTurns: opts.totalTurns,
    async buildTurn(t) {
      calls.push(`build:${t}`);
      return `in:${t}`;
    },
    async execute(input) {
      calls.push(`execute:${input}`);
      return `out:${input}`;
    },
    record(t, input, output) {
      calls.push(`record:${t}:${input}:${output}`);
    },
    async shouldEarlyStop(t) {
      calls.push(`stop?:${t}`);
      return opts.stopAfter === t;
    },
    async finalize() {
      calls.push("finalize");
      return RESULT;
    },
  };
}

test("runs each turn build→execute→record→shouldEarlyStop, then finalize once", async () => {
  const driver = trackingDriver({ startTurn: 1, totalTurns: 2 });
  const result = await runAttack(driver);
  assert.strictEqual(result, RESULT);
  assert.deepStrictEqual(driver.calls, [
    "build:1",
    "execute:in:1",
    "record:1:in:1:out:in:1",
    "stop?:1",
    "build:2",
    "execute:in:2",
    "record:2:in:2:out:in:2",
    "stop?:2",
    "finalize",
  ]);
});

test("early-stop breaks the loop but still finalizes", async () => {
  const driver = trackingDriver({ startTurn: 1, totalTurns: 5, stopAfter: 2 });
  await runAttack(driver);
  // Turn 3+ never build; finalize still runs.
  assert.deepStrictEqual(driver.calls, [
    "build:1",
    "execute:in:1",
    "record:1:in:1:out:in:1",
    "stop?:1",
    "build:2",
    "execute:in:2",
    "record:2:in:2:out:in:2",
    "stop?:2",
    "finalize",
  ]);
});

test("honors startTurn when resuming a partial transcript", async () => {
  const driver = trackingDriver({ startTurn: 3, totalTurns: 4 });
  await runAttack(driver);
  assert.deepStrictEqual(driver.calls, [
    "build:3",
    "execute:in:3",
    "record:3:in:3:out:in:3",
    "stop?:3",
    "build:4",
    "execute:in:4",
    "record:4:in:4:out:in:4",
    "stop?:4",
    "finalize",
  ]);
});

test("runs zero turns when startTurn exceeds totalTurns, still finalizes", async () => {
  const driver = trackingDriver({ startTurn: 3, totalTurns: 2 });
  await runAttack(driver);
  assert.deepStrictEqual(driver.calls, ["finalize"]);
});

test("an already-aborted signal stops before turn 1, still finalizes", async () => {
  const driver = trackingDriver({ startTurn: 1, totalTurns: 100 });
  const ac = new AbortController();
  ac.abort();
  await runAttack(driver, ac.signal);
  assert.deepStrictEqual(driver.calls, ["finalize"]);
});

test("a signal aborted mid-run stops before the next turn, not after totalTurns", async () => {
  const driver = trackingDriver({ startTurn: 1, totalTurns: 100 });
  const ac = new AbortController();
  const originalShouldEarlyStop = driver.shouldEarlyStop.bind(driver);
  driver.shouldEarlyStop = async (t, input, output) => {
    const result = await originalShouldEarlyStop(t, input, output);
    if (t === 2) ac.abort(); // simulate Ctrl+C landing mid-attack
    return result;
  };
  await runAttack(driver, ac.signal);
  // Turn 3 never builds — the loop only reached turns 1 and 2.
  assert.deepStrictEqual(driver.calls, [
    "build:1",
    "execute:in:1",
    "record:1:in:1:out:in:1",
    "stop?:1",
    "build:2",
    "execute:in:2",
    "record:2:in:2:out:in:2",
    "stop?:2",
    "finalize",
  ]);
});

test("no signal behaves exactly as before (backward compatible)", async () => {
  const driver = trackingDriver({ startTurn: 1, totalTurns: 2 });
  const result = await runAttack(driver, undefined);
  assert.strictEqual(result, RESULT);
  assert.deepStrictEqual(driver.calls, [
    "build:1",
    "execute:in:1",
    "record:1:in:1:out:in:1",
    "stop?:1",
    "build:2",
    "execute:in:2",
    "record:2:in:2:out:in:2",
    "stop?:2",
    "finalize",
  ]);
});
