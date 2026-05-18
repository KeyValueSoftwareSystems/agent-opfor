import type { Command } from "commander";
import { readFile, mkdir } from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { log } from "../../../../core/dist/lib/logger.js";
import { createModel } from "../../../../core/dist/providers/factory.js";
import { judgeResponse, errorJudge } from "../../../../core/dist/evaluators/judge.js";
import type { ConversationTurn, JudgeResult } from "../../../../core/dist/evaluators/judge.js";
import { generateReport } from "../../../../core/dist/report/generateReport.js";
import type {
  EvaluatorReport,
  TestResult,
  TurnRecord,
} from "../../../../core/dist/report/generateReport.js";
import type { EvaluatorSpec } from "../../../../core/dist/evaluators/parseEvaluator.js";
import type { PromptsFile, AttackEntry } from "../../../../core/dist/config/types.js";
import { resolveTelemetryEnv } from "../../../../core/dist/config/resolveTelemetryEnv.js";
import type { RunAgentConfigHttp } from "../../../../core/dist/lib/agent.js";
import {
  callTargetHttp,
  generateNextAttackTurn,
  isTargetError,
  extractErrorMessage,
} from "../../../../core/dist/lib/agent.js";
import { invokeLocalTargetScript } from "../../../../core/dist/lib/localScriptTarget.js";
import { newOtelTraceId } from "../../../../core/dist/lib/tracePropagation.js";

// Suppress noisy AI SDK compatibility warnings
(globalThis as Record<string, unknown>).AI_SDK_LOG_WARNINGS = false;

export async function runAgentAttacksFromFile(opts: {
  input: string;
  targetScript?: string;
  outputDir?: string;
  concurrency?: string;
}): Promise<{ html: string; json: string }> {
  let promptsFile: PromptsFile;
  const inputPath = path.resolve(opts.input);
  try {
    const raw = await readFile(inputPath, "utf8");
    promptsFile = JSON.parse(raw) as PromptsFile;
    promptsFile.telemetry = resolveTelemetryEnv(promptsFile.telemetry);
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    throw new Error(`Error reading prompts file: ${msg}`, { cause: err });
  }

  const { target, attacks } = promptsFile;
  const attackLlm = promptsFile.attackLlm;
  const judgeLlm = promptsFile.judgeLlm ?? attackLlm;

  if (!attacks || attacks.length === 0) {
    throw new Error("No attack entries found in the prompts file. Run `opfor generate` first.");
  }

  log.success(`Loaded ${attacks.length} attack(s) from: ${inputPath}`);

  const targetScriptCli = typeof opts.targetScript === "string" ? opts.targetScript.trim() : "";
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
    throw new Error(
      "Target type is http-endpoint but no endpoint URL is specified in the prompts file."
    );
  }

  if (target.type === "local-script" && !useLocalScript) {
    throw new Error(
      "Target type is local-script but no script path was found. " +
        "Set target.scriptPath in your setup config, or pass --target-script <path>."
    );
  }

  let model;
  let judgeModel;
  try {
    model = createModel(attackLlm);
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    throw new Error(`Error initialising generator LLM provider "${attackLlm.provider}": ${msg}`, {
      cause: err,
    });
  }
  try {
    judgeModel = createModel(judgeLlm);
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    throw new Error(`Error initialising judge LLM provider "${judgeLlm.provider}": ${msg}`, {
      cause: err,
    });
  }

  const endpoint = target.endpoint ?? "";
  const targetFormat = target.requestFormat ?? "auto";
  const targetModel = target.targetModel ?? "gpt-4o-mini";
  const generatorLabel = `${attackLlm.provider}/${attackLlm.model}`;
  const judgeLabel =
    judgeLlm === attackLlm ? generatorLabel : `${judgeLlm.provider}/${judgeLlm.model}`;

  const byEvaluator = new Map<string, AttackEntry[]>();
  for (const attack of attacks) {
    const list = byEvaluator.get(attack.evaluatorId) ?? [];
    list.push(attack);
    byEvaluator.set(attack.evaluatorId, list);
  }

  log.info(
    `Target:  ${endpoint || (resolvedScript ? path.basename(resolvedScript) : (target.name ?? "(target)"))}`
  );
  log.info(`Judge:   ${judgeLabel}`);
  log.info(`Attacks: ${attacks.length} across ${byEvaluator.size} evaluator(s)\n`);

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

    log.start(`Evaluator: ${evaluatorId} (${entries.length} attack(s))`);

    const evaluatorSpec: EvaluatorSpec = {
      id: evaluatorId,
      name: first.evaluatorName,
      severity: first.severity,
      owasp: first.owasp,
      description: first.description ?? "",
      passCriteria: first.passCriteria,
      failCriteria: first.failCriteria,
      patterns: [],
    };

    const results: TestResult[] = [];
    let testNumber = 1;

    for (const attack of entries) {
      const isMultiTurn = attack.turnMode === "multi";
      const numTurns = isMultiTurn ? (attack.turns ?? 3) : 1;

      const attackLabel = isMultiTurn
        ? `[${totalRun + testNumber}/${attacks.length}] ${attack.patternName} · multi-turn (${numTurns} turns)`
        : `[${totalRun + testNumber}/${attacks.length}] ${attack.patternName}`;
      log.start(attackLabel);
      const sessionId = isMultiTurn || target.sessionIdField ? randomUUID() : undefined;

      const conversationHistory: ConversationTurn[] = [];
      const turnResults: TurnRecord[] = [];

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
        targetHeaders: target.headers,
      };

      for (let t = 1; t <= numTurns; t++) {
        if (isMultiTurn) log.log(`  ── turn ${t}/${numTurns}`);

        let userMessage: string;
        if (t === 1) {
          userMessage = attack.prompt;
        } else {
          userMessage = await generateNextAttackTurn(conversationHistory, attack.prompt, model);
        }

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
          response = "(no target configured — pass --target-script or set up http-endpoint)";
        }

        conversationHistory.push({ role: "user", content: userMessage });
        conversationHistory.push({ role: "assistant", content: response });

        turnResults.push({ turnIndex: t, prompt: userMessage, response });

        if (isTargetError(response)) break;
      }

      const finalTurn = turnResults[turnResults.length - 1];
      const finalJudge: JudgeResult = !finalTurn
        ? {
            verdict: "FAIL" as const,
            score: 0,
            confidence: 0,
            evidence: "N/A",
            reasoning: "No turns completed",
          }
        : isTargetError(finalTurn.response)
          ? errorJudge(extractErrorMessage(finalTurn.response))
          : await judgeResponse(
              evaluatorSpec,
              finalTurn.prompt,
              finalTurn.response,
              judgeModel,
              undefined,
              isMultiTurn ? conversationHistory : undefined,
              { patternName: attack.patternName }
            );
      const verdictLabel =
        finalJudge.verdict === "PASS"
          ? "✔ PASS"
          : finalJudge.verdict === "ERROR"
            ? "⚠ ERROR"
            : "✖ FAIL";
      if (finalJudge.verdict === "ERROR") {
        log.log(
          `  ${verdictLabel} · ${"errorMessage" in finalJudge && finalJudge.errorMessage ? String(finalJudge.errorMessage) : "error"}`
        );
      } else {
        log.log(
          `  ${verdictLabel} · score ${finalJudge.score}/10 · confidence ${finalJudge.confidence}%`
        );
      }

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

  const outputDir = path.resolve(opts.outputDir || ".opfor/reports");
  await mkdir(outputDir, { recursive: true });

  const reportEndpoint = useLocalScript && resolvedScript ? resolvedScript : endpoint || "(target)";

  const paths = await generateReport(
    reports,
    target.name,
    reportEndpoint,
    outputDir,
    judgeLabel,
    generatorLabel
  );

  let totalPass = 0,
    totalFail = 0,
    totalError = 0;
  for (const r of reports) {
    for (const t of r.results) {
      if (t.judge.verdict === "PASS") totalPass++;
      else if (t.judge.verdict === "FAIL") totalFail++;
      else totalError++;
    }
  }
  const safetyScore = totalRun > 0 ? Math.round((totalPass / totalRun) * 100) : 0;

  log.success(`Report written:`);
  log.log(`  HTML: ${paths.html}`);
  log.log(`  JSON: ${paths.json}`);
  log.box(
    `Safety score: ${safetyScore}%  ·  ${totalPass}/${totalRun} passed  ·  ${totalFail} attack(s) succeeded` +
      (totalError > 0 ? `  ·  ${totalError} error(s) excluded` : "")
  );

  return paths;
}

export function registerRunCommand(program: Command) {
  program
    .command("execute")
    .description("Execute an Opfor scan from an attacks JSON file generated by `opfor generate`")
    .requiredOption(
      "--input <path>",
      "Path to the .opfor/attacks/opfor-attacks-*.json file from generate"
    )
    .option(
      "--target-script <path>",
      "Run each attack against this .js or .py script (node / python3 is picked from the extension): " +
        "stdin JSON { prompt, context }, stdout JSON { response }. Overrides an HTTP target when set."
    )
    .option("--output-dir <path>", "Directory to write HTML/JSON reports", ".opfor/reports")
    .option("--concurrency <n>", "Max parallel attacks (default 1 — sequential)", "1")
    .action(async (opts) => {
      try {
        const paths = await runAgentAttacksFromFile({
          input: opts.input,
          targetScript: opts.targetScript,
          outputDir: opts.outputDir,
          concurrency: opts.concurrency,
        });
        console.log(`\nReports:`);
        console.log(`  HTML: ${paths.html}`);
        console.log(`  JSON: ${paths.json}\n`);
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        console.error(msg);
        process.exitCode = 1;
      }
    });
}
