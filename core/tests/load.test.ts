/**
 * Seed knowledge loader — personas/strategies from `data/`, vuln-classes from
 * the evaluator taxonomy.
 *
 * Pins the Step-2 behavior change: `seedDir` overrides personas/strategies only;
 * vulnerability classes always come from `evaluators/agent/` regardless of it.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { loadKnowledge } from "../src/autonomous/knowledge/load.js";
import { HUNT_VULN_CLASS_CATEGORIES } from "../src/autonomous/knowledge/vulnClasses.js";

function writeSeedFixture(): string {
  const dir = mkdtempSync(path.join(tmpdir(), "opfor-seed-"));
  mkdirSync(path.join(dir, "personas"), { recursive: true });
  mkdirSync(path.join(dir, "strategies"), { recursive: true });
  writeFileSync(
    path.join(dir, "personas", "tester.md"),
    `---\nid: tester\nname: Tester\nvoice: calm\ntraits: curious\nwhen_to_use: always\n---\nbody\n`,
    "utf8"
  );
  writeFileSync(
    path.join(dir, "strategies", "probe.md"),
    `---\nid: probe\nname: Probe\nmechanics: poke\nwhen_to_use: early\nescalation_notes: harder\n---\nbody\n`,
    "utf8"
  );
  return dir;
}

test("loadKnowledge reads personas/strategies from an explicit seedDir", async () => {
  const dir = writeSeedFixture();
  try {
    const kb = await loadKnowledge(dir);
    assert.deepEqual(
      kb.personas.map((p) => p.id),
      ["tester"]
    );
    assert.deepEqual(
      kb.strategies.map((s) => s.id),
      ["probe"]
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("vuln-classes come from the evaluator taxonomy regardless of seedDir", async () => {
  // seedDir has no vuln-classes/ dir at all — they must still load from evaluators/.
  const dir = writeSeedFixture();
  try {
    const kb = await loadKnowledge(dir);
    assert.equal(kb.vulnClasses.length, HUNT_VULN_CLASS_CATEGORIES.length);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("loadKnowledge with no args resolves the repo-root data/ dir", async () => {
  // Runs inside the monorepo: personas/strategies exist at repo-root data/.
  const kb = await loadKnowledge();
  assert.ok(kb.personas.length > 0, "expected personas from repo-root data/");
  assert.ok(kb.strategies.length > 0, "expected strategies from repo-root data/");
  assert.equal(kb.vulnClasses.length, HUNT_VULN_CLASS_CATEGORIES.length);
});
