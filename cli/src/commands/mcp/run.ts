import path from "node:path";
import { readFile } from "node:fs/promises";
import { Command } from "commander";
import { log } from "../../../../core/dist/lib/logger.js";
import { connectMcpClient } from "../../../../core/dist/mcp-client/createClient.js";
import { executeAttack } from "../../../../core/dist/run/executeAttack.js";
import {
  judgeToolResponse,
  sanitizeJudgeResult,
  errorJudge,
} from "../../../../core/dist/run/judge.js";
import { generateNextMcpAttackTurn } from "../../../../core/dist/run/generateNextMcpAttackTurn.js";
import type { ToolCallTurn } from "../../../../core/dist/run/generateNextMcpAttackTurn.js";

import { loadEvaluatorCriteria } from "../../../../core/dist/catalog/loadEvaluatorCriteria.js";
import { buildReport, enrichReportWithCriteria } from "../../../../core/dist/report/buildReport.js";
import { writeHtmlReport } from "../../../../core/dist/report/renderHtml.js";
import type { AttackPlanWritten } from "../../../../core/dist/attacks/planSchema.js";
import type { AttackRunResult, TurnRecord } from "../../../../core/dist/run/types.js";

interface ParsedToolResponse {
  text: string;
  isError: boolean;
}

/** Parse MCP tool response JSON into readable text + error flag. */
function parseToolResponse(raw: string): ParsedToolResponse {
  if (!raw) return { text: "(empty)", isError: false };
  try {
    const parsed = JSON.parse(raw) as {
      content?: Array<{ type?: string; text?: string }>;
      isError?: boolean;
    };
    const texts = (parsed.content ?? [])
      .filter((c) => c.type === "text" && typeof c.text === "string")
      .map((c) => c.text as string);
    const text = texts.join("\n").trim() || raw;
    return { text, isError: parsed.isError === true };
  } catch {
    return { text: raw, isError: false };
  }
}

const DEFAULT_ATTACKS_FILE = "opfor-mcp-attacks.json";
const DEFAULT_REPORT_DIR = ".opfor/reports";

export async function runMcpAttackPlan(opts: {
  input: string;
  outDir: string;
}): Promise<{ html: string; json: string }> {
  const { input, outDir } = opts;

  const inputPath = path.resolve(input);
  log.info(`Loading attack plan: ${inputPath}`);
  const planRaw = await readFile(inputPath, "utf8");
  const plan = JSON.parse(planRaw) as AttackPlanWritten;
  log.success(`Loaded ${plan.attacks.length} attacks (suite: ${plan.suiteId})`);

  if (!plan.server) {
    throw new Error(
      "Attack plan is missing embedded server config. " +
        "Re-run `opfor generate --config <path>` to regenerate the plan with current config."
    );
  }
  if (!plan.generatorModel) {
    throw new Error(
      "Attack plan is missing embedded generator model config. " +
        "Re-run `opfor generate --config <path>` to regenerate the plan with current config."
    );
  }

  const judgeModelCfg = plan.judgeModel ?? plan.generatorModel;

  const evaluatorIds = [...new Set(plan.attacks.map((a) => a.evaluatorId))];
  const criteriaMap = new Map(
    await Promise.all(
      evaluatorIds.map(async (id) => [id, await loadEvaluatorCriteria(id)] as const)
    )
  );

  const resolvedOutDir = path.resolve(outDir);
  log.info(`Reports will be written to: ${resolvedOutDir}`);
  log.start("Connecting to MCP server…");
  const mcp = await connectMcpClient(plan.server);
  log.success("Connected.");

  const runResults: AttackRunResult[] = [];
  const unauthServerUrl = plan.server.transport !== "stdio" ? plan.server.url : undefined;

  try {
    for (let i = 0; i < plan.attacks.length; i++) {
      const attack = plan.attacks[i];
      log.start(`[${i + 1}/${plan.attacks.length}] Running: ${attack.id}`);

      const criteria = criteriaMap.get(attack.evaluatorId);
      if (!criteria) throw new Error(`No criteria loaded for evaluator: ${attack.evaluatorId}`);

      const numTurns = attack.turns ?? 1;

      if (numTurns <= 1) {
        const execResult = await executeAttack(mcp, attack, undefined, unauthServerUrl);

        const isTransportFailure = Boolean(execResult.toolError && !execResult.rawToolResponse);
        const judgeResult = isTransportFailure
          ? errorJudge(execResult.toolError!)
          : sanitizeJudgeResult(
              await judgeToolResponse({
                model: judgeModelCfg,
                evaluator: criteria,
                attackSummary: attack.summary,
                toolName: execResult.toolName,
                toolArguments: execResult.toolArguments,
                toolResponse: execResult.rawToolResponse,
                toolError: execResult.toolError,
                judgeHint: attack.judgeHint,
              }),
              {
                attackSummary: attack.summary,
                toolArguments: execResult.toolArguments,
                toolResponse: execResult.rawToolResponse,
                toolError: execResult.toolError,
              }
            );

        const singleResult: AttackRunResult = { ...execResult, judge: judgeResult };
        runResults.push(singleResult);

        const verdict =
          judgeResult.verdict === "PASS"
            ? "✔ PASS"
            : judgeResult.verdict === "ERROR"
              ? "⚠ ERROR"
              : "✖ FAIL";
        log.log(
          judgeResult.verdict === "ERROR"
            ? `  ${verdict} · ${judgeResult.errorMessage}`
            : `  ${verdict} · score ${judgeResult.score}/10 · confidence ${judgeResult.confidence}%`
        );

        log.log(`  ↑ req  ${execResult.toolName}`);
        log.log(`         ${JSON.stringify(execResult.toolArguments, null, 2)}`);
        if (execResult.toolError) {
          log.log(`  ↓ err  ${execResult.toolError}`);
        } else {
          const { text, isError } = parseToolResponse(execResult.rawToolResponse);
          const errorTag = isError ? " [isError=true]" : "";
          log.log(`  ↓ res${errorTag}  ${text.slice(0, 300)}`);
        }

        if (judgeResult.verdict !== "ERROR" && judgeResult.reasoning) {
          log.log(`  ⚑ ${judgeResult.reasoning}`);
        }
      } else {
        log.log(`  ↻ multi-turn (${numTurns} turns)`);
        const turnHistory: ToolCallTurn[] = [];
        const turnResults: TurnRecord[] = [];

        for (let t = 1; t <= numTurns; t++) {
          log.log(`  ── turn ${t}/${numTurns}`);

          let overrideArgs: Record<string, unknown> | undefined;
          let turnJudgeHint: string | undefined = attack.judgeHint;
          if (t > 1) {
            const turnResult = await generateNextMcpAttackTurn(
              turnHistory,
              attack.summary,
              attack.suggestedToolName ?? "",
              (attack.suggestedToolArguments ?? {}) as Record<string, unknown>,
              plan.generatorModel,
              plan.attackerInstructions
            );
            overrideArgs = turnResult.args;
            turnJudgeHint = turnResult.judgeHint ?? attack.judgeHint;
          }

          const turnExec = await executeAttack(mcp, attack, overrideArgs, unauthServerUrl);

          const isTransportFailure = Boolean(turnExec.toolError && !turnExec.rawToolResponse);
          const judgeResult = isTransportFailure
            ? errorJudge(turnExec.toolError!)
            : sanitizeJudgeResult(
                await judgeToolResponse({
                  model: judgeModelCfg,
                  evaluator: criteria,
                  attackSummary: attack.summary,
                  toolName: turnExec.toolName,
                  toolArguments: turnExec.toolArguments,
                  toolResponse: turnExec.rawToolResponse,
                  toolError: turnExec.toolError,
                  judgeHint: turnJudgeHint,
                }),
                {
                  attackSummary: attack.summary,
                  toolArguments: turnExec.toolArguments,
                  toolResponse: turnExec.rawToolResponse,
                  toolError: turnExec.toolError,
                }
              );

          turnHistory.push({
            toolName: turnExec.toolName,
            toolArguments: turnExec.toolArguments,
            rawToolResponse: turnExec.rawToolResponse,
            toolError: turnExec.toolError,
            judgeVerdict: judgeResult.verdict,
            judgeReasoning: judgeResult.reasoning || undefined,
          });

          turnResults.push({
            turnIndex: t,
            toolName: turnExec.toolName,
            toolArguments: turnExec.toolArguments,
            rawToolResponse: turnExec.rawToolResponse,
            toolError: turnExec.toolError,
            judge: judgeResult,
          });

          const verdict =
            judgeResult.verdict === "PASS"
              ? "✔ PASS"
              : judgeResult.verdict === "ERROR"
                ? "⚠ ERROR"
                : "✖ FAIL";
          log.log(
            `     ${verdict}${
              judgeResult.verdict !== "ERROR"
                ? ` · score ${judgeResult.score}/10`
                : ` · ${judgeResult.errorMessage}`
            }`
          );

          log.log(
            `     ↑ ${turnExec.toolName}  ${JSON.stringify(turnExec.toolArguments, null, 2)}`
          );
          if (turnExec.toolError) {
            log.log(`     ↓ err  ${turnExec.toolError}`);
          } else {
            const { text, isError } = parseToolResponse(turnExec.rawToolResponse);
            log.log(`     ↓ res${isError ? " [isError=true]" : ""}  ${text.slice(0, 200)}`);
          }

          if (judgeResult.verdict !== "PASS") break;
        }

        const finalTurn = turnResults[turnResults.length - 1];
        const multiResult: AttackRunResult = {
          attackId: attack.id,
          evaluatorId: attack.evaluatorId,
          toolName: finalTurn.toolName,
          toolArguments: finalTurn.toolArguments,
          rawToolResponse: finalTurn.rawToolResponse,
          toolError: finalTurn.toolError,
          judge: finalTurn.judge,
          turns: turnResults,
        };
        runResults.push(multiResult);

        const overallVerdict = finalTurn.judge.verdict;
        const verdictLabel =
          overallVerdict === "PASS" ? "✔ PASS" : overallVerdict === "ERROR" ? "⚠ ERROR" : "✖ FAIL";
        log.log(`  ${verdictLabel} after ${turnResults.length} turn(s)`);
        if (finalTurn.judge.reasoning) log.log(`  ⚑ ${finalTurn.judge.reasoning}`);
      }
    }
  } catch (runErr: unknown) {
    if (runResults.length > 0) {
      try {
        let partialReport = buildReport({
          plan,
          results: runResults,
          generatorModel: plan.generatorModel,
          judgeModel: judgeModelCfg,
        });
        partialReport = enrichReportWithCriteria(
          partialReport,
          new Map(
            [...criteriaMap.entries()].map(([id, c]) => [
              id,
              { name: c.name, owasp: c.owasp ?? "", severity: c.severity },
            ])
          )
        );
        const { html, json } = await writeHtmlReport(partialReport, resolvedOutDir);
        log.warn(
          `Run interrupted — partial report (${runResults.length}/${plan.attacks.length} attacks):`
        );
        log.log(`  HTML: ${html}`);
        log.log(`  JSON: ${json}`);
      } catch {
        /* ignore */
      }
    }
    throw runErr;
  } finally {
    await mcp.close().catch(() => undefined);
  }

  let report = buildReport({
    plan,
    results: runResults,
    generatorModel: plan.generatorModel,
    judgeModel: judgeModelCfg,
  });
  report = enrichReportWithCriteria(
    report,
    new Map(
      [...criteriaMap.entries()].map(([id, c]) => [
        id,
        { name: c.name, owasp: c.owasp ?? "", severity: c.severity },
      ])
    )
  );

  const paths = await writeHtmlReport(report, resolvedOutDir);

  log.success(`Report written:`);
  log.log(`  HTML: ${paths.html}`);
  log.log(`  JSON: ${paths.json}`);
  log.box(
    `Safety score: ${report.summary.safetyScore}%  ·  ${report.summary.passed}/${report.summary.total} passed  ·  ${report.summary.failed} attack(s) succeeded` +
      (report.summary.errors > 0 ? `  ·  ${report.summary.errors} error(s) excluded` : "")
  );

  return paths;
}

export function registerRunCommand(program: Command) {
  program
    .command("run")
    .description("Execute attacks from a plan file, judge each result, and write an HTML report")
    .option(
      "-i, --input <path>",
      `Attack plan file (default: ./${DEFAULT_ATTACKS_FILE})`,
      DEFAULT_ATTACKS_FILE
    )
    .option(
      "-o, --out-dir <path>",
      `Report output directory (default: ./${DEFAULT_REPORT_DIR})`,
      DEFAULT_REPORT_DIR
    )
    .action(async ({ input, outDir }: { input: string; outDir: string }) => {
      try {
        await runMcpAttackPlan({ input, outDir });
        process.exit(0);
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        log.error(msg);
        process.exit(1);
      }
    });
}
