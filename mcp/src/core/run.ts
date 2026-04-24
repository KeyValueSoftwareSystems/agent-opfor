import { readFile, mkdir } from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { createModel } from "@astra/core/providers/factory";
import { judgeResponse } from "@astra/core/evaluators/judge";
import { generateReport } from "@astra/core/report/generateReport";
import type { EvaluatorReport, TestResult } from "@astra/core/report/generateReport";
import type { EvaluatorSpec } from "@astra/core/evaluators/parseEvaluator";
import type { AttackEntry, PromptsFile } from "@astra/core/config/types";
import { resolveTelemetryEnv } from "@astra/core/config/resolveTelemetryEnv";
import type { RunAgentConfigHttp } from "@astra/core/lib/agent";
import { runAttackAgent } from "@astra/core/lib/agent";
import { invokeLocalTargetScript } from "@astra/core/lib/localScriptTarget";
import { newOtelTraceId } from "@astra/core/lib/tracePropagation";

export interface RunOptions {
  inputPath: string;
  apiKey?: string;
  outputDir?: string;
  /** If set, run attacks against this script (stdin JSON, stdout JSON response). */
  targetScript?: string;
}

export interface RunSummary {
  target: string;
  endpoint: string;
  totalAttacks: number;
  passed: number;
  failed: number;
  safetyScore: number;
  htmlReport: string;
  jsonReport: string;
  evaluatorResults: Array<{
    id: string;
    name: string;
    severity: string;
    owasp: string;
    passed: number;
    failed: number;
    passRate: number;
  }>;
  criticalFindings: Array<{
    evaluator: string;
    score: number;
    description: string;
  }>;
}

export async function runScan(opts: RunOptions): Promise<RunSummary> {
  const { inputPath, apiKey: apiKeyOverride, outputDir = ".astra/reports", targetScript: targetScriptOpt } = opts;

  const raw = await readFile(path.resolve(inputPath), "utf8");
  const promptsFile = JSON.parse(raw) as PromptsFile;
  promptsFile.telemetry = resolveTelemetryEnv(promptsFile.telemetry);
  const { target, attacks } = promptsFile;

  if (!attacks || attacks.length === 0) {
    throw new Error("No attack entries in the prompts file. Run astra_setup first.");
  }

  const targetScriptCli = targetScriptOpt?.trim() ?? "";
  const resolvedScript = targetScriptCli
    ? path.resolve(process.cwd(), targetScriptCli)
    : target.type === "local-script" && target.scriptPath?.trim()
      ? path.resolve(process.cwd(), target.scriptPath.trim())
      : target.type === "python-function" && target.scriptPath?.trim()
        ? path.resolve(process.cwd(), target.scriptPath.trim())
        : null;

  const useLocalScript = Boolean(resolvedScript);
  const useHttp = target.type === "http-endpoint" && !useLocalScript;

  if (useHttp && !target.endpoint) {
    throw new Error("Target type is http-endpoint but no endpoint URL is specified.");
  }
  if (target.type === "local-script" && !useLocalScript) {
    throw new Error(
      "Target type is local-script but no script path. Set target.scriptPath in config or pass targetScript."
    );
  }

  const llm = {
    ...promptsFile.llm,
    ...(apiKeyOverride?.trim() ? { apiKey: apiKeyOverride.trim() } : {}),
  };

  const model = createModel(llm);
  const endpoint = target.endpoint ?? "";
  const targetFormat = target.requestFormat ?? "auto";
  const targetModel = target.targetModel ?? "gpt-4o-mini";
  const judgeLabel = `${llm.provider}/${llm.model}`;

  // Group by evaluator
  const byEvaluator = new Map<string, AttackEntry[]>();
  for (const attack of attacks) {
    const list = byEvaluator.get(attack.evaluatorId) ?? [];
    list.push(attack);
    byEvaluator.set(attack.evaluatorId, list);
  }

  const reports: EvaluatorReport[] = [];
  let totalRun = 0;
  const propagation = promptsFile.telemetry?.propagation;
  const scanRunId = randomUUID();
  let runTraceOtel: string | undefined;
  const propagationStrategy = propagation?.traceIdStrategy ?? "per-attack";
  if (propagationStrategy === "per-run") {
    runTraceOtel = newOtelTraceId();
  }

  for (const [evaluatorId, entries] of byEvaluator) {
    const first = entries[0];

    const evaluatorSpec: EvaluatorSpec = {
      id: evaluatorId,
      name: first.evaluatorName,
      severity: first.severity,
      owasp: first.owasp,
      description: "",
      passCriteria: first.passCriteria,
      failCriteria: first.failCriteria,
      patterns: [],
    };

    const results: TestResult[] = [];
    let testNumber = 1;

    for (const attack of entries) {
      if (useHttp) {
        const agentCfg: RunAgentConfigHttp = {
          attack,
          targetApiKey: target.targetApiKey,
          model,
          endpoint,
          targetFormat,
          targetModel,
          telemetry: promptsFile.telemetry,
          propagation,
          runTraceOtel,
          runId: scanRunId,
          attackIndex: totalRun + testNumber,
        };
        const result = await runAttackAgent(agentCfg);
        results.push({
          testNumber: totalRun + testNumber,
          pattern: attack.patternName,
          prompt: attack.prompt,
          response: result.response,
          judge: result.judge,
          ...(result.traceId ? { traceId: result.traceId } : {}),
        });
      } else if (useLocalScript && resolvedScript) {
        const responseText = await invokeLocalTargetScript(resolvedScript, {
          prompt: attack.prompt,
          context: { targetName: target.name },
        });
        const judgeResult = await judgeResponse(
          evaluatorSpec,
          attack.prompt,
          responseText,
          model
        );
        results.push({
          testNumber: totalRun + testNumber,
          pattern: attack.patternName,
          prompt: attack.prompt,
          response: responseText,
          judge: judgeResult,
        });
      } else {
        const judgeResult = await judgeResponse(
          evaluatorSpec,
          attack.prompt,
          "(no target script — configure local-script / scriptPath or pass targetScript)",
          model
        );
        results.push({
          testNumber: totalRun + testNumber,
          pattern: attack.patternName,
          prompt: attack.prompt,
          response: "(skipped — no local script configured)",
          judge: judgeResult,
        });
      }
      testNumber++;
    }

    totalRun += entries.length;
    reports.push({ evaluator: evaluatorSpec, results });
  }

  // Write reports
  const resolvedOutputDir = path.resolve(outputDir);
  await mkdir(resolvedOutputDir, { recursive: true });

  const transportLabel = useLocalScript
    ? `local script: ${resolvedScript}`
    : useHttp
      ? endpoint
      : target.type === "python-function"
        ? "python-function (no script path)"
        : "(not configured)";
  const reportEndpoint = useLocalScript && resolvedScript ? resolvedScript : endpoint || transportLabel;

  const reportPaths = await generateReport(
    reports,
    target.name,
    reportEndpoint,
    resolvedOutputDir,
    judgeLabel
  );

  // Build summary
  const allResults = reports.flatMap(r => r.results);
  const passed = allResults.filter(r => r.judge.verdict === "PASS").length;
  const failed = totalRun - passed;
  const safetyScore = totalRun > 0 ? Math.round((passed / totalRun) * 100) : 0;

  const criticalFindings = reports
    .filter(r => r.evaluator.severity === "critical")
    .flatMap(r =>
      r.results
        .filter(t => t.judge.verdict === "FAIL")
        .map(t => ({
          evaluator: r.evaluator.name,
          score: t.judge.score,
          description: t.judge.reasoning,
        }))
    )
    .sort((a, b) => b.score - a.score);

  const evaluatorResults = reports.map(r => {
    const p = r.results.filter(t => t.judge.verdict === "PASS").length;
    const f = r.results.length - p;
    return {
      id: r.evaluator.id,
      name: r.evaluator.name,
      severity: r.evaluator.severity,
      owasp: r.evaluator.owasp,
      passed: p,
      failed: f,
      passRate: r.results.length > 0 ? Math.round((p / r.results.length) * 100) : 0,
    };
  });

  return {
    target: target.name,
    endpoint: endpoint || "(python-function)",
    totalAttacks: totalRun,
    passed,
    failed,
    safetyScore,
    htmlReport: reportPaths.html,
    jsonReport: reportPaths.json,
    evaluatorResults,
    criticalFindings,
  };
}
