import { readFile, mkdir } from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { createModel } from "../../../core/dist/providers/factory.js";
import { judgeResponse, errorJudge } from "../../../core/dist/evaluators/judge.js";
import type { ConversationTurn, JudgeResult } from "../../../core/dist/evaluators/judge.js";
import { generateReport } from "../../../core/dist/report/generateReport.js";
import type {
  EvaluatorReport,
  TestResult,
  TurnRecord,
} from "../../../core/dist/report/generateReport.js";
import type { EvaluatorSpec } from "../../../core/dist/evaluators/parseEvaluator.js";
import type { AttackEntry, PromptsFile } from "../../../core/dist/config/types.js";
import { resolveTelemetryEnv } from "../../../core/dist/config/resolveTelemetryEnv.js";
import type { RunAgentConfigHttp } from "../../../core/dist/lib/agent.js";
import {
  callTargetHttp,
  generateNextAttackTurn,
  isTargetError,
  extractErrorMessage,
} from "../../../core/dist/lib/agent.js";
import { invokeLocalTargetScript } from "../../../core/dist/lib/localScriptTarget.js";
import { newOtelTraceId } from "../../../core/dist/lib/tracePropagation.js";

export interface RunOptions {
  inputPath: string;
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
  errors: number;
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
  const { inputPath, outputDir = ".astra/reports", targetScript: targetScriptOpt } = opts;

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

  const attackLlm = promptsFile.attackLlm;
  const judgeLlm = promptsFile.judgeLlm ?? attackLlm;

  const model = createModel(attackLlm);
  const judgeModel = createModel(judgeLlm);
  const endpoint = target.endpoint ?? "";
  const targetFormat = target.requestFormat ?? "auto";
  const targetModel = target.targetModel ?? "gpt-4o-mini";
  const generatorLabel = `${attackLlm.provider}/${attackLlm.model}`;
  const judgeLabel =
    judgeLlm === attackLlm ? generatorLabel : `${judgeLlm.provider}/${judgeLlm.model}`;

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
      const isMultiTurn = attack.turnMode === "multi";
      const numTurns = isMultiTurn ? (attack.turns ?? 3) : 1;
      const sessionId = isMultiTurn || target.sessionIdField ? randomUUID() : undefined;

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
        sessionIdField: target.sessionIdField,
        promptPath: target.promptPath,
        responsePath: target.responsePath,
      };

      const conversationHistory: ConversationTurn[] = [];
      const turnResults: TurnRecord[] = [];

      for (let t = 1; t <= numTurns; t++) {
        // Determine message for this turn
        let userMessage: string;
        if (t === 1) {
          userMessage = attack.prompt;
        } else {
          userMessage = await generateNextAttackTurn(conversationHistory, attack.prompt, model);
        }

        // Call the target
        let response: string;
        if (useHttp) {
          response = await callTargetHttp(agentCfg, userMessage, sessionId);
        } else if (useLocalScript && resolvedScript) {
          response = await invokeLocalTargetScript(resolvedScript, {
            prompt: userMessage,
            context: { targetName: target.name },
            sessionId,
          });
        } else {
          response =
            "(no target configured — configure local-script / scriptPath or pass targetScript)";
        }

        // Update conversation history
        conversationHistory.push({ role: "user", content: userMessage });
        conversationHistory.push({ role: "assistant", content: response });

        // Short-circuit: skip LLM judge when the target itself failed
        let judge: JudgeResult;
        if (isTargetError(response)) {
          judge = errorJudge(extractErrorMessage(response));
        } else {
          judge = await judgeResponse(
            evaluatorSpec,
            userMessage,
            response,
            judgeModel,
            undefined,
            isMultiTurn ? conversationHistory : undefined
          );
        }

        turnResults.push({ turnIndex: t, prompt: userMessage, response, judge });

        // Early exit on failure or error
        if (judge.verdict === "FAIL" || judge.verdict === "ERROR") {
          break;
        }
      }

      const finalTurn = turnResults[turnResults.length - 1];
      const finalJudge = finalTurn?.judge ?? {
        verdict: "FAIL" as const,
        score: 0,
        confidence: 0,
        evidence: "N/A",
        reasoning: "No turns completed",
      };

      results.push({
        testNumber: totalRun + testNumber,
        pattern: attack.patternName,
        prompt: attack.prompt,
        response: finalTurn?.response ?? "",
        judge: finalJudge,
        ...(isMultiTurn ? { turns: turnResults } : {}),
      });

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
  const reportEndpoint =
    useLocalScript && resolvedScript ? resolvedScript : endpoint || transportLabel;

  const reportPaths = await generateReport(
    reports,
    target.name,
    reportEndpoint,
    resolvedOutputDir,
    judgeLabel,
    generatorLabel
  );

  // Build summary — errors excluded from safety score denominator
  const allResults = reports.flatMap((r) => r.results);
  const passed = allResults.filter((r) => r.judge.verdict === "PASS").length;
  const errors = allResults.filter((r) => r.judge.verdict === "ERROR").length;
  const failed = totalRun - passed - errors;
  const scoreDenominator = passed + failed;
  const safetyScore = scoreDenominator > 0 ? Math.round((passed / scoreDenominator) * 100) : 0;

  const criticalFindings = reports
    .filter((r) => r.evaluator.severity === "critical")
    .flatMap((r) =>
      r.results
        .filter((t) => t.judge.verdict === "FAIL")
        .map((t) => ({
          evaluator: r.evaluator.name,
          score: t.judge.score,
          description: t.judge.reasoning,
        }))
    )
    .sort((a, b) => a.score - b.score);

  const evaluatorResults = reports.map((r) => {
    const p = r.results.filter((t) => t.judge.verdict === "PASS").length;
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
    errors,
    safetyScore,
    htmlReport: reportPaths.html,
    jsonReport: reportPaths.json,
    evaluatorResults,
    criticalFindings,
  };
}
