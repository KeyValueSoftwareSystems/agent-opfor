import { test } from "node:test";
import assert from "node:assert/strict";
import { tmpdir } from "node:os";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { JsonlEventListener } from "../src/lib/jsonlEventListener.js";

async function tmpFile() {
  const dir = await mkdtemp(path.join(tmpdir(), "opfor-events-"));
  return { dir, file: path.join(dir, "events.jsonl") };
}

async function readLines(file: string): Promise<Array<Record<string, unknown>>> {
  const raw = await readFile(file, "utf8");
  return raw
    .split("\n")
    .filter((l) => l.trim())
    .map((l) => JSON.parse(l) as Record<string, unknown>);
}

test("writes one NDJSON line per lifecycle event with type + payload", async () => {
  const { dir, file } = await tmpFile();
  try {
    const l = new JsonlEventListener(file);
    l.onRunStart({ evaluatorCount: 2 });
    l.onEvaluatorStart({ evaluatorId: "e1", evaluatorName: "Eval One" });
    l.onAttackDone({ attackId: "a1", verdict: "FAIL" });
    l.onEvaluatorDone({ evaluatorId: "e1", passed: 1, failed: 2, errors: 0 });
    l.onRunError({ error: new Error("boom") });
    l.onRunFinish({
      reportId: "r1",
      summary: { total: 3, passed: 1, failed: 2, errors: 0, safetyScore: 33 },
    } as never);

    const lines = await readLines(file);
    assert.deepStrictEqual(
      lines.map((e) => e.type),
      ["run_start", "evaluator_start", "attack_done", "evaluator_done", "run_error", "run_finish"]
    );
    assert.strictEqual(lines[0].evaluatorCount, 2);
    assert.strictEqual(lines[2].verdict, "FAIL");
    assert.strictEqual(lines[4].error, "boom"); // Error unwrapped to its message
    assert.deepStrictEqual((lines[5].summary as { failed: number }).failed, 2);
    // Every line carries a timestamp.
    assert.ok(lines.every((e) => typeof e.ts === "string"));
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("truncates a stale file on construction (fresh per run)", async () => {
  const { dir, file } = await tmpFile();
  try {
    await writeFile(file, '{"type":"stale"}\n');
    const l = new JsonlEventListener(file);
    l.onRunStart({ evaluatorCount: 0 });

    const lines = await readLines(file);
    assert.strictEqual(lines.length, 1, "stale content is discarded");
    assert.strictEqual(lines[0].type, "run_start");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
