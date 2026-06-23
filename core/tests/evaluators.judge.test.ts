/**
 * Evaluator judge smoke tests.
 *
 * Discovers every *.test.yaml fixture alongside evaluator YAML files, feeds
 * the synthetic pass_case and fail_case responses through the LLM judge, and
 * asserts the judge returns the expected verdict.
 *
 * Requires a live LLM — set JUDGE_PROVIDER + the matching API key env var,
 * or defaults to groq + GROQ_API_KEY.
 *
 * Run:
 *   GROQ_API_KEY=... node --import tsx/esm --test core/tests/evaluators.judge.test.ts
 *
 * Filter to a single evaluator:
 *   EVALUATOR_FILTER=prompt-injection GROQ_API_KEY=... node --import tsx/esm --test core/tests/evaluators.judge.test.ts
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { readdir, readFile, stat } from "node:fs/promises";
import path from "node:path";
import { parse as parseYaml } from "yaml";
import { parseEvaluator } from "../src/evaluators/parseEvaluator.js";
import { judgeResponse, type JudgeResult } from "../src/evaluators/judge.js";
import { createModel } from "../src/providers/factory.js";
import type { LlmConfig } from "../src/config/types.js";
import { getEvaluatorsDir, type EvaluatorCategory } from "../src/config/evaluatorsLayout.js";

interface TestCase {
  response: string;
  expect: "PASS" | "FAIL";
}

interface TestFixture {
  kind: string;
  pass_case: TestCase;
  fail_case: TestCase;
}

function buildJudgeLlmConfig(): LlmConfig {
  const provider = (process.env.JUDGE_PROVIDER ?? "groq") as LlmConfig["provider"];
  const envVarMap: Record<string, string> = {
    groq: "GROQ_API_KEY",
    openai: "OPENAI_API_KEY",
    anthropic: "ANTHROPIC_API_KEY",
    google: "GOOGLE_GENERATIVE_AI_API_KEY",
    deepseek: "DEEPSEEK_API_KEY",
  };
  const modelMap: Record<string, string> = {
    groq: "llama-3.3-70b-versatile",
    openai: "gpt-4o-mini",
    anthropic: "claude-3-5-haiku-20241022",
    google: "gemini-2.0-flash",
    deepseek: "deepseek-chat",
  };
  return {
    provider,
    model: process.env.JUDGE_MODEL ?? modelMap[provider] ?? "llama-3.3-70b-versatile",
    apiKeyEnv: envVarMap[provider] ?? "GROQ_API_KEY",
  };
}

/**
 * Recursively find all *.test.yaml files under a category's evaluators directory.
 */
async function discoverTestFixtures(
  category: EvaluatorCategory
): Promise<{ testPath: string; evaluatorPath: string }[]> {
  const baseDir = getEvaluatorsDir(category);
  const results: { testPath: string; evaluatorPath: string }[] = [];

  async function walk(dir: string): Promise<void> {
    let entries: string[];
    try {
      entries = await readdir(dir);
    } catch {
      return;
    }

    for (const entry of entries) {
      const fullPath = path.join(dir, entry);
      const s = await stat(fullPath);

      if (s.isDirectory()) {
        await walk(fullPath);
      } else if (/\.test\.ya?ml$/i.test(entry)) {
        // Find the companion evaluator.yaml — either in the same directory
        // (directory-form) or the file with the same base name minus .test
        // (flat-file form).
        const dirEntries = await readdir(dir);
        const evalYaml = dirEntries.find((e) => /^evaluator\.ya?ml$/i.test(e));
        if (evalYaml) {
          results.push({
            testPath: fullPath,
            evaluatorPath: path.join(dir, evalYaml),
          });
        } else {
          // Flat-file: <id>.test.yaml → <id>.yaml
          const baseName = entry.replace(/\.test\.ya?ml$/i, "");
          const flatEval = dirEntries.find(
            (e) => e === `${baseName}.yaml` || e === `${baseName}.yml`
          );
          if (flatEval) {
            results.push({
              testPath: fullPath,
              evaluatorPath: path.join(dir, flatEval),
            });
          }
        }
      }
    }
  }

  await walk(baseDir);
  return results;
}

function parseTestFixture(raw: string): TestFixture {
  const doc = parseYaml(raw) as Record<string, unknown>;
  const kind = typeof doc.kind === "string" ? doc.kind : "response";
  const passRaw = doc.pass_case as Record<string, unknown>;
  const failRaw = doc.fail_case as Record<string, unknown>;
  return {
    kind,
    pass_case: {
      response: String(passRaw?.response ?? ""),
      expect: String(passRaw?.expect ?? "PASS").toUpperCase() as "PASS" | "FAIL",
    },
    fail_case: {
      response: String(failRaw?.response ?? ""),
      expect: String(failRaw?.expect ?? "FAIL").toUpperCase() as "PASS" | "FAIL",
    },
  };
}

const llmConfig = buildJudgeLlmConfig();
const apiKeyValue = process.env[llmConfig.apiKeyEnv]?.trim();
const hasApiKey = Boolean(apiKeyValue);
const model = hasApiKey
  ? createModel(llmConfig)
  : (null as unknown as ReturnType<typeof createModel>);
const filter = process.env.EVALUATOR_FILTER?.toLowerCase();

async function runCategoryTests(category: EvaluatorCategory): Promise<void> {
  const fixtures = await discoverTestFixtures(category);
  assert.ok(fixtures.length > 0, `expected test fixtures in ${category}`);

  const filtered = filter
    ? fixtures.filter((f) => f.evaluatorPath.toLowerCase().includes(filter))
    : fixtures;

  if (filtered.length === 0 && filter) {
    console.log(`  [skip] no ${category} evaluators match filter "${filter}"`);
    return;
  }

  let passed = 0;
  let failed = 0;
  const failures: string[] = [];

  for (const { testPath, evaluatorPath } of filtered) {
    const evalId = path.basename(path.dirname(testPath));
    const fixtureRaw = await readFile(testPath, "utf8");
    const fixture = parseTestFixture(fixtureRaw);
    const evaluator = await parseEvaluator(evaluatorPath);

    // Test pass_case
    let passResult: JudgeResult;
    try {
      passResult = await judgeResponse(
        evaluator,
        "(synthetic test prompt)",
        fixture.pass_case.response,
        model
      );
    } catch (err) {
      failures.push(`${evalId} pass_case: judge threw: ${err}`);
      failed++;
      continue;
    }

    if (passResult.verdict !== fixture.pass_case.expect) {
      failures.push(
        `${evalId} pass_case: expected ${fixture.pass_case.expect}, got ${passResult.verdict} ` +
          `(score=${passResult.score}, reasoning="${passResult.reasoning}")`
      );
      failed++;
    } else {
      passed++;
    }

    // Test fail_case
    let failResult: JudgeResult;
    try {
      failResult = await judgeResponse(
        evaluator,
        "(synthetic test prompt)",
        fixture.fail_case.response,
        model
      );
    } catch (err) {
      failures.push(`${evalId} fail_case: judge threw: ${err}`);
      failed++;
      continue;
    }

    if (failResult.verdict !== fixture.fail_case.expect) {
      failures.push(
        `${evalId} fail_case: expected ${fixture.fail_case.expect}, got ${failResult.verdict} ` +
          `(score=${failResult.score}, reasoning="${failResult.reasoning}")`
      );
      failed++;
    } else {
      passed++;
    }
  }

  console.log(`  ${category}: ${passed} passed, ${failed} failed (${filtered.length} evaluators)`);
  if (failures.length > 0) {
    console.log(`\n  Failures:\n    ${failures.join("\n    ")}`);
  }
  assert.equal(failed, 0, `${failed} judge test(s) failed:\n  ${failures.join("\n  ")}`);
}

test(
  "agent evaluator judge smoke tests",
  { skip: !hasApiKey && "no LLM API key set", timeout: 600_000 },
  async () => {
    await runCategoryTests("agent");
  }
);

test(
  "mcp evaluator judge smoke tests",
  { skip: !hasApiKey && "no LLM API key set", timeout: 600_000 },
  async () => {
    await runCategoryTests("mcp");
  }
);
