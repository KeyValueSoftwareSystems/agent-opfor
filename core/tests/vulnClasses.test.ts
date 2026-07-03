/**
 * Hunt vuln-class loader — derived from evaluator category READMEs.
 *
 * Guards the taxonomy migration: hunt's vulnerability classes are read from
 * `evaluators/agent/<category>/README.md` (the allow-listed subset), not a
 * separate hand-maintained library. Also pins the "fail loud" contract — a
 * missing/renamed category README must throw, not silently shrink the list.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  loadVulnClasses,
  HUNT_VULN_CLASS_CATEGORIES,
} from "../src/autonomous/knowledge/vulnClasses.js";

const SEVERITIES = ["critical", "high", "medium", "low"];

test("loadVulnClasses returns exactly the allow-listed categories", async () => {
  const classes = await loadVulnClasses();
  const ids = classes.map((c) => c.id).sort();
  const expected = [...HUNT_VULN_CLASS_CATEGORIES].sort();
  assert.deepEqual(ids, expected);
});

test("every vuln-class has a valid severity and non-empty rubrics", async () => {
  const classes = await loadVulnClasses();
  for (const c of classes) {
    assert.ok(SEVERITIES.includes(c.severity), `${c.id}: bad severity "${c.severity}"`);
    assert.ok(c.name.length > 0, `${c.id}: empty name`);
    assert.ok(c.description.length > 0, `${c.id}: empty description`);
    assert.ok(c.failRubric.length > 0, `${c.id}: empty failRubric`);
    assert.ok(c.passRubric.length > 0, `${c.id}: empty passRubric`);
  }
});

test("throws (does not silently shrink) when an allow-listed README is missing", async () => {
  // Build a fixture evaluators dir with only SOME of the allow-listed categories.
  const dir = mkdtempSync(path.join(tmpdir(), "opfor-vulnclass-"));
  try {
    const present = HUNT_VULN_CLASS_CATEGORIES.slice(0, 2);
    for (const id of present) {
      const catDir = path.join(dir, id);
      mkdirSync(catDir, { recursive: true });
      writeFileSync(
        path.join(catDir, "README.md"),
        `---\nid: ${id}\nname: ${id}\nsurface: agent\nseverity: medium\n` +
          `description: test\nfail_rubric: fails\npass_rubric: passes\n---\nbody\n`,
        "utf8"
      );
    }
    await assert.rejects(() => loadVulnClasses(dir), /README\.md/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("throws with an actionable message when severity is missing", async () => {
  const dir = mkdtempSync(path.join(tmpdir(), "opfor-vulnclass-"));
  try {
    for (const id of HUNT_VULN_CLASS_CATEGORIES) {
      const catDir = path.join(dir, id);
      mkdirSync(catDir, { recursive: true });
      // Deliberately omit severity: to exercise the schema failure path.
      writeFileSync(
        path.join(catDir, "README.md"),
        `---\nid: ${id}\nname: ${id}\nsurface: agent\n` +
          `description: test\nfail_rubric: fails\npass_rubric: passes\n---\nbody\n`,
        "utf8"
      );
    }
    await assert.rejects(() => loadVulnClasses(dir), /severity/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
