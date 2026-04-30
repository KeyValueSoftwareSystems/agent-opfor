import path from "node:path";
import { readFile } from "node:fs/promises";
import { Command } from "commander";
import { DEFAULT_ASTRA_MCP_CONFIG, requireAstraMcpConfig } from "../lib/astraConfig.js";
import { loadAstraMcpConfigFile } from "../lib/loadAstraMcpConfig.js";
import { log } from "../lib/logger.js";
import { connectMcpClient } from "../mcp/createClient.js";
import { executeAttack } from "../run/executeAttack.js";
import { judgeToolResponse, sanitizeJudgeResult, errorJudge } from "../run/judge.js";
import { generateNextMcpAttackTurn } from "../run/generateNextMcpAttackTurn.js";
import type { ToolCallTurn } from "../run/generateNextMcpAttackTurn.js";
import { loadEvaluatorCriteria } from "../catalog/loadEvaluatorCriteria.js";
import { buildReport, enrichReportWithCriteria } from "../report/buildReport.js";
import { writeHtmlReport } from "../report/renderHtml.js";
import type { AttackPlanWritten } from "../attacks/planSchema.js";
import type { AttackRunResult, TurnRecord } from "../run/types.js";

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

const DEFAULT_ATTACKS_FILE = "astra-mcp-attacks.json";
const DEFAULT_REPORT_DIR = ".astra/reports";

export function registerRunCommand(program: Command) {
  program
    .command("run")
    .description("Execute attacks from a plan file, judge each result, and write an HTML report")
    .option("-c, --config <path>", `Path to config file (default: ./${DEFAULT_ASTRA_MCP_CONFIG})`)
    .option("-i, --input <path>", `Attack plan file (default: ./${DEFAULT_ATTACKS_FILE})`, DEFAULT_ATTACKS_FILE)
    .option("-o, --out-dir <path>", `Report output directory (default: ./${DEFAULT_REPORT_DIR})`, DEFAULT_REPORT_DIR)
    .action(async ({ config, input, outDir }: { config?: string; input: string; outDir: string }) => {
      try {
        const configPath = await requireAstraMcpConfig(config);
        const cfg = await loadAstraMcpConfigFile(configPath);

        const inputPath = path.resolve(input);
        log.info(`Loading attack plan: ${inputPath}`);
        const planRaw = await readFile(inputPath, "utf8");
        const plan = JSON.parse(planRaw) as AttackPlanWritten;
        log.success(`Loaded ${plan.attacks.length} attacks (suite: ${plan.suiteId})`);

        // Pre-load evaluator criteria for judging
        const evaluatorIds = [...new Set(plan.attacks.map((a) => a.evaluatorId))];
        const criteriaMap = new Map(
          await Promise.all(
            evaluatorIds.map(async (id) => [id, await loadEvaluatorCriteria(id)] as const)
          )
        );

        // Connect once, run all attacks, disconnect
        const resolvedOutDir = path.resolve(outDir);
        log.info(`Reports will be written to: ${resolvedOutDir}`);
        log.start("Connecting to MCP server…");
        const mcp = await connectMcpClient(cfg.server);
        log.success("Connected.");

        const runResults: AttackRunResult[] = [];

        try {
          for (let i = 0; i < plan.attacks.length; i++) {
            const attack = plan.attacks[i];
            log.start(`[${i + 1}/${plan.attacks.length}] Running: ${attack.id}`);

            const criteria = criteriaMap.get(attack.evaluatorId);
            if (!criteria) throw new Error(`No criteria loaded for evaluator: ${attack.evaluatorId}`);

            const numTurns = attack.turns ?? 1;

            if (numTurns <= 1) {
              // ── Single-turn path ──────────────────────────────────────────────
              const execResult = await executeAttack(mcp, attack);

              const isTransportFailure = Boolean(execResult.toolError && !execResult.rawToolResponse);
              const judgeResult = isTransportFailure
                ? errorJudge(execResult.toolError!)
                : sanitizeJudgeResult(
                    await judgeToolResponse({
                      model: cfg.models.run,
                      evaluator: criteria,
                      attackSummary: attack.summary,
                      toolName: execResult.toolName,
                      toolArguments: execResult.toolArguments,
                      toolResponse: execResult.rawToolResponse,
                      toolError: execResult.toolError,
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

              const verdict = judgeResult.verdict === "PASS" ? "✔ PASS" : judgeResult.verdict === "ERROR" ? "⚠ ERROR" : "✖ FAIL";
              log.log(judgeResult.verdict === "ERROR"
                ? `  ${verdict} · ${judgeResult.errorMessage}`
                : `  ${verdict} · score ${judgeResult.score}/10 · confidence ${judgeResult.confidence}%`);

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
              // ── Multi-turn adaptive path ──────────────────────────────────────
              log.log(`  ↻ multi-turn (${numTurns} turns)`);
              const turnHistory: ToolCallTurn[] = [];
              const turnResults: TurnRecord[] = [];

              for (let t = 1; t <= numTurns; t++) {
                log.log(`  ── turn ${t}/${numTurns}`);

                let overrideArgs: Record<string, unknown> | undefined;
                if (t > 1) {
                  overrideArgs = await generateNextMcpAttackTurn(
                    turnHistory,
                    attack.summary,
                    attack.suggestedToolName ?? "",
                    cfg.models.run
                  );
                }

                const turnExec = await executeAttack(mcp, attack, overrideArgs);

                turnHistory.push({
                  toolName: turnExec.toolName,
                  toolArguments: turnExec.toolArguments,
                  rawToolResponse: turnExec.rawToolResponse,
                  toolError: turnExec.toolError,
                });

                const isTransportFailure = Boolean(turnExec.toolError && !turnExec.rawToolResponse);
                const judgeResult = isTransportFailure
                  ? errorJudge(turnExec.toolError!)
                  : sanitizeJudgeResult(
                      await judgeToolResponse({
                        model: cfg.models.run,
                        evaluator: criteria,
                        attackSummary: attack.summary,
                        toolName: turnExec.toolName,
                        toolArguments: turnExec.toolArguments,
                        toolResponse: turnExec.rawToolResponse,
                        toolError: turnExec.toolError,
                      }),
                      {
                        attackSummary: attack.summary,
                        toolArguments: turnExec.toolArguments,
                        toolResponse: turnExec.rawToolResponse,
                        toolError: turnExec.toolError,
                      }
                    );

                turnResults.push({
                  turnIndex: t,
                  toolName: turnExec.toolName,
                  toolArguments: turnExec.toolArguments,
                  rawToolResponse: turnExec.rawToolResponse,
                  toolError: turnExec.toolError,
                  judge: judgeResult,
                });

                const verdict = judgeResult.verdict === "PASS" ? "✔ PASS" : judgeResult.verdict === "ERROR" ? "⚠ ERROR" : "✖ FAIL";
                log.log(`     ${verdict}${judgeResult.verdict !== "ERROR" ? ` · score ${judgeResult.score}/10` : ` · ${judgeResult.errorMessage}`}`);

                log.log(`     ↑ ${turnExec.toolName}  ${JSON.stringify(turnExec.toolArguments, null, 2)}`);
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
              const verdictLabel = overallVerdict === "PASS" ? "✔ PASS" : overallVerdict === "ERROR" ? "⚠ ERROR" : "✖ FAIL";
              log.log(`  ${verdictLabel} after ${turnResults.length} turn(s)`);
              if (finalTurn.judge.reasoning) log.log(`  ⚑ ${finalTurn.judge.reasoning}`);
            }
          }
        } catch (runErr: unknown) {
          if (runResults.length > 0) {
            try {
              let partialReport = buildReport({ plan, results: runResults, runModel: cfg.models.run });
              partialReport = enrichReportWithCriteria(
                partialReport,
                new Map(
                  [...criteriaMap.entries()].map(([id, c]) => [id, { name: c.name, owasp: c.owasp ?? "", severity: c.severity }])
                )
              );
              const { html, json } = await writeHtmlReport(partialReport, resolvedOutDir);
              log.warn(`Run interrupted — partial report (${runResults.length}/${plan.attacks.length} attacks):`);
              log.log(`  HTML: ${html}`);
              log.log(`  JSON: ${json}`);
            } catch {
              // ignore report write failures during error handling
            }
          }
          throw runErr;
        } finally {
          await mcp.close().catch(() => undefined);
        }

        // Build + enrich report
        let report = buildReport({ plan, results: runResults, runModel: cfg.models.run });
        report = enrichReportWithCriteria(
          report,
          new Map(
            [...criteriaMap.entries()].map(([id, c]) => [id, { name: c.name, owasp: c.owasp ?? "", severity: c.severity }])
          )
        );

        const { html, json } = await writeHtmlReport(report, resolvedOutDir);

        log.success(`Report written:`);
        log.log(`  HTML: ${html}`);
        log.log(`  JSON: ${json}`);
        log.box(
          `Safety score: ${report.summary.safetyScore}%  ·  ${report.summary.passed}/${report.summary.total} passed  ·  ${report.summary.failed} attack(s) succeeded`
          + (report.summary.errors > 0 ? `  ·  ${report.summary.errors} error(s) excluded` : "")
        );
        // Force-exit: stdio child processes can keep the event loop alive even after
        // transport.close(), preventing Node from exiting naturally.
        process.exit(0);
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        log.error(msg);
        process.exit(1);
      }
    });
}
