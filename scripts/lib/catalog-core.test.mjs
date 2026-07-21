/**
 * Unit tests for the shared build-time catalog primitives used by both the
 * skills generator (scripts/build-catalog.ts) and the extension generator
 * (runners/extension/scripts/build-catalog.mjs).
 *
 * Run: node --test scripts/lib/*.test.mjs
 */
import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import {
  discoverEvaluatorFiles,
  parseEvaluator,
  parseSuite,
  deriveStandardSuites,
} from "./catalog-core.mjs";

describe("deriveStandardSuites", () => {
  test("returns no suites when no evaluator carries a recognized standards tag", () => {
    const suites = deriveStandardSuites([
      { id: "a", standards: { "made-up-standard": "X1" } },
      { id: "b" },
    ]);
    assert.deepStrictEqual(suites, []);
  });

  test("groups evaluators by standards key into the matching derived suite", () => {
    const suites = deriveStandardSuites([
      { id: "prompt-injection", standards: { "owasp-llm": "LLM01" } },
      { id: "excessive-agency", standards: { "owasp-agentic": "ASI01" } },
      { id: "another-llm-one", standards: { "owasp-llm": "LLM02" } },
    ]);

    const byId = Object.fromEntries(suites.map((s) => [s.id, s]));
    assert.deepStrictEqual(byId["owasp-llm-top10"].evaluatorIds, [
      "prompt-injection",
      "another-llm-one",
    ]);
    assert.deepStrictEqual(byId["owasp-agentic-ai"].evaluatorIds, ["excessive-agency"]);
    assert.strictEqual(byId["owasp-llm-top10"].derived, true);
  });

  test("emits every standard group when tagged, each marked derived", () => {
    const evaluators = [
      { id: "e1", standards: { "owasp-llm": "LLM01" } },
      { id: "e2", standards: { "owasp-api": "API01" } },
      { id: "e3", standards: { "owasp-agentic": "ASI01" } },
      { id: "e4", standards: { "owasp-mcp": "MCP01" } },
      { id: "e5", standards: { atlas: "AML.T0001" } },
      { id: "e6", standards: { "eu-ai-act": "Art.5" } },
      { id: "e7", standards: { nist: "GOVERN-1.1" } },
    ];
    const suites = deriveStandardSuites(evaluators);
    const ids = suites.map((s) => s.id);
    assert.deepStrictEqual(ids, [
      "owasp-llm-top10",
      "owasp-api-top10",
      "owasp-agentic-ai",
      "owasp-mcp-top10",
      "mitre-atlas",
      "eu-ai-act",
      "nist-ai-rmf",
    ]);
    assert.ok(suites.every((s) => s.derived === true));
  });

  test("ignores evaluators with no standards at all", () => {
    const suites = deriveStandardSuites([{ id: "no-standards-here" }]);
    assert.deepStrictEqual(suites, []);
  });
});

describe("parseEvaluator / discoverEvaluatorFiles / parseSuite (fixture-backed)", () => {
  let tmpRoot;
  let suitesDir;

  before(async () => {
    tmpRoot = await mkdtemp(path.join(tmpdir(), "catalog-core-test-"));
    // Separate from tmpRoot: discoverEvaluatorFiles recurses, so a suite fixture
    // nested inside tmpRoot would get picked up as a flat-file evaluator too.
    suitesDir = await mkdtemp(path.join(tmpdir(), "catalog-core-test-suites-"));

    // Directory-form evaluator with a patterns/ dir, whitebox + MCP + surfaces fields.
    const dirEval = path.join(tmpRoot, "my-directory-eval");
    await mkdir(path.join(dirEval, "patterns"), { recursive: true });
    await writeFile(
      path.join(dirEval, "evaluator.yaml"),
      [
        "id: my-directory-eval",
        "name: My Directory Eval",
        "severity: critical",
        "description: A test evaluator.",
        "pass_criteria: Defends.",
        "fail_criteria: Fails.",
        "standards:",
        "  owasp-llm: LLM01",
        "scan_mode: source_code",
        "correlates_with: my-directory-eval-dynamic",
        "source_scan:",
        "  languages: [python]",
        "judge_needs_llm: true",
        "applies_to_all_tools: false",
        "mcp_top_10: MCP01",
        "surfaces: [agent, mcp, not-a-real-surface]",
        "",
      ].join("\n"),
      "utf8"
    );
    await writeFile(
      path.join(dirEval, "patterns", "one.yaml"),
      ["name: Pattern One", "template: Do the thing.", "judge_hint: Look for X."].join("\n"),
      "utf8"
    );

    // Flat-file evaluator with inline patterns, no whitebox/MCP/surfaces fields.
    await writeFile(
      path.join(tmpRoot, "my-flat-eval.yaml"),
      [
        "id: my-flat-eval",
        "name: My Flat Eval",
        "severity: medium",
        "description: Another test evaluator.",
        "pass_criteria: Defends.",
        "fail_criteria: Fails.",
        "patterns:",
        "  - name: Inline Pattern",
        "    template: Try this.",
        "",
      ].join("\n"),
      "utf8"
    );

    // A fixture that must be ignored by discovery.
    await writeFile(
      path.join(tmpRoot, "my-flat-eval.test.yaml"),
      "id: should-be-ignored\n",
      "utf8"
    );

    // Curated suite fixture — lives in the separate suitesDir, matching evaluators/ vs suites/.
    await writeFile(
      path.join(suitesDir, "a-suite.yaml"),
      [
        "id: a-suite",
        "name: A Suite",
        "description: A curated suite.",
        "evaluators: [my-directory-eval, ' my-flat-eval ']",
        "",
      ].join("\n"),
      "utf8"
    );
  });

  after(async () => {
    await rm(tmpRoot, { recursive: true, force: true });
    await rm(suitesDir, { recursive: true, force: true });
  });

  test("discoverEvaluatorFiles finds both forms and ignores *.test.yaml", async () => {
    const found = await discoverEvaluatorFiles(tmpRoot);
    const names = found.map((f) => path.basename(f.filePath)).sort();
    assert.deepStrictEqual(names, ["evaluator.yaml", "my-flat-eval.yaml"]);
  });

  test("parseEvaluator maps directory-form fields to camelCase and carries whitebox/MCP/surfaces through", async () => {
    const [discovered] = await discoverEvaluatorFiles(tmpRoot).then((all) =>
      all.filter((f) => f.filePath.endsWith("evaluator.yaml"))
    );
    const ev = await parseEvaluator(discovered);

    assert.strictEqual(ev.id, "my-directory-eval");
    assert.strictEqual(ev.passCriteria, "Defends.");
    assert.strictEqual(ev.failCriteria, "Fails.");
    assert.ok(!("pass_criteria" in ev), "should not leak the snake_case source key");
    assert.deepStrictEqual(ev.standards, { "owasp-llm": "LLM01" });

    assert.strictEqual(ev.scanMode, "source_code");
    assert.strictEqual(ev.correlatesWith, "my-directory-eval-dynamic");
    assert.deepStrictEqual(ev.sourceScan, { languages: ["python"] });

    assert.strictEqual(ev.judgeNeedsLlm, true);
    assert.strictEqual(ev.appliesToAllTools, false);
    assert.strictEqual(ev.mcpTop10, "MCP01");

    // Invalid surface values are filtered out; valid ones are kept.
    assert.deepStrictEqual(ev.surfaces, ["agent", "mcp"]);

    assert.strictEqual(ev.patterns.length, 1);
    assert.strictEqual(ev.patterns[0].name, "Pattern One");
    assert.strictEqual(ev.patterns[0].judgeHint, "Look for X.");
  });

  test("parseEvaluator handles flat-file inline patterns and omits absent optional fields", async () => {
    const [discovered] = await discoverEvaluatorFiles(tmpRoot).then((all) =>
      all.filter((f) => f.filePath.endsWith("my-flat-eval.yaml"))
    );
    const ev = await parseEvaluator(discovered);

    assert.strictEqual(ev.id, "my-flat-eval");
    assert.strictEqual(ev.patterns.length, 1);
    assert.strictEqual(ev.patterns[0].template, "Try this.");

    for (const absentField of [
      "standards",
      "scanMode",
      "correlatesWith",
      "sourceScan",
      "judgeNeedsLlm",
      "appliesToAllTools",
      "mcpTop10",
      "surfaces",
    ]) {
      assert.ok(!(absentField in ev), `${absentField} should be absent when not set in YAML`);
    }
  });

  test("parseSuite trims id/name/description/evaluatorIds", async () => {
    const suite = await parseSuite(path.join(suitesDir, "a-suite.yaml"));
    assert.strictEqual(suite.id, "a-suite");
    assert.deepStrictEqual(suite.evaluatorIds, ["my-directory-eval", "my-flat-eval"]);
  });
});
