import path from "node:path";
import { readFile } from "node:fs/promises";
import { Command } from "commander";
import { log } from "../../../../../core/dist/lib/logger.js";
import { connectMcpClient } from "../../../../../core/dist/mcp-client/createClient.js";
import { executeAttack } from "../../../../../core/dist/run/executeAttack.js";
import {
  judgeToolResponse,
  sanitizeJudgeResult,
  errorJudge,
} from "../../../../../core/dist/run/judge.js";
import { generateNextMcpAttackTurn } from "../../../../../core/dist/run/generateNextMcpAttackTurn.js";
import type { ToolCallTurn } from "../../../../../core/dist/run/generateNextMcpAttackTurn.js";

import { loadEvaluatorCriteria } from "../../../../../core/dist/catalog/loadEvaluatorCriteria.js";
import {
  buildReport,
  enrichReportWithCriteria,
  writeHtmlReport,
} from "../../../../../core/dist/report/mcpReport.js";
import { scanResources } from "../../../../../core/dist/run/scanResources.js";
import type { AttackPlanWritten } from "../../../../../core/dist/attacks/planSchema.js";
import type { AttackRunResult, TurnRecord } from "../../../../../core/dist/run/types.js";

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

  // Phase 0: Resource scan — enumerate and read all MCP resources, judge for exposure
  const scanEnabled = (plan as Record<string, unknown>).scanResources !== false;
  if (scanEnabled) {
    log.start("Scanning MCP resources (resources/list + resources/read)…");
    const resourceScan = await scanResources(mcp);
    if (resourceScan.resources.length === 0) {
      log.info("No resources exposed by this server.");
    } else {
      log.success(
        `resources/list: ${resourceScan.resources.length} resource(s)` +
          (resourceScan.templates.length > 0
            ? `, ${resourceScan.templates.length} template(s)`
            : "")
      );

      let resourceCriteria = criteriaMap.get("resource-exposure");
      if (!resourceCriteria) {
        try {
          resourceCriteria = await loadEvaluatorCriteria("resource-exposure");
          criteriaMap.set("resource-exposure", resourceCriteria);
        } catch {
          resourceCriteria = {
            id: "resource-exposure",
            name: "MCP Resource Exposure",
            ref: "MCP01",
            severity: "critical",
            passCriteria:
              "Resource contains only benign/public data. No credentials, API keys, or secrets.",
            failCriteria:
              "Resource contains hardcoded credentials, API keys, database connection strings, private keys, or PII.",
          };
          criteriaMap.set("resource-exposure", resourceCriteria);
        }
      }

      for (let ri = 0; ri < resourceScan.resources.length; ri++) {
        const res = resourceScan.resources[ri];
        const attackId = `resource-exposure-${res.name}-${ri + 1}`;
        log.start(`[resource ${ri + 1}/${resourceScan.resources.length}] Reading: ${res.uri}`);

        if (res.readError) {
          log.log(`  ↓ err  ${res.readError}`);
          runResults.push({
            attackId,
            evaluatorId: "resource-exposure",
            toolName: "resources/read",
            toolArguments: { uri: res.uri },
            rawToolResponse: "",
            toolError: res.readError,
            judge: errorJudge(res.readError),
          });
          continue;
        }

        const rawResponse = JSON.stringify({
          content: [{ type: "text", text: res.content }],
          isError: false,
        });

        const judgeResult = sanitizeJudgeResult(
          await judgeToolResponse({
            model: judgeModelCfg,
            evaluator: resourceCriteria,
            attackSummary: `Read MCP resource "${res.name}" (${res.uri})${res.description ? ` — ${res.description}` : ""}`,
            toolName: "resources/read",
            toolArguments: { uri: res.uri },
            toolResponse: rawResponse,
            judgeHint:
              "FAIL if the resource contains hardcoded credentials, API keys, passwords, database connection strings, private keys, or other secrets that should not be exposed to any MCP client. PASS if the content is benign operational data.",
          }),
          {
            attackSummary: `Read MCP resource "${res.name}" (${res.uri})`,
            toolArguments: { uri: res.uri },
            toolResponse: rawResponse,
          }
        );

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
        log.log(`  ↓ res  ${res.content.slice(0, 300)}`);
        if (judgeResult.verdict !== "ERROR" && judgeResult.reasoning) {
          log.log(`  ⚑ ${judgeResult.reasoning}`);
        }

        runResults.push({
          attackId,
          evaluatorId: "resource-exposure",
          toolName: "resources/read",
          toolArguments: { uri: res.uri },
          rawToolResponse: rawResponse,
          judge: judgeResult,
        });
      }
    }
  }

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
          }

          const turnExec = await executeAttack(mcp, attack, overrideArgs, unauthServerUrl);

          const isTransportFailure = Boolean(turnExec.toolError && !turnExec.rawToolResponse);

          turnHistory.push({
            toolName: turnExec.toolName,
            toolArguments: turnExec.toolArguments,
            rawToolResponse: turnExec.rawToolResponse,
            toolError: turnExec.toolError,
          });

          turnResults.push({
            turnIndex: t,
            toolName: turnExec.toolName,
            toolArguments: turnExec.toolArguments,
            rawToolResponse: turnExec.rawToolResponse,
            toolError: turnExec.toolError,
          });

          log.log(
            `     ↑ ${turnExec.toolName}  ${JSON.stringify(turnExec.toolArguments, null, 2)}`
          );
          if (turnExec.toolError) {
            log.log(`     ↓ err  ${turnExec.toolError}`);
          } else {
            const { text, isError } = parseToolResponse(turnExec.rawToolResponse);
            log.log(`     ↓ res${isError ? " [isError=true]" : ""}  ${text.slice(0, 200)}`);
          }

          if (isTransportFailure) break;
        }

        const finalTurn = turnResults[turnResults.length - 1];
        const isFinalTransport = Boolean(finalTurn.toolError && !finalTurn.rawToolResponse);
        const finalJudge = isFinalTransport
          ? errorJudge(finalTurn.toolError!)
          : sanitizeJudgeResult(
              await judgeToolResponse({
                model: judgeModelCfg,
                evaluator: criteria,
                attackSummary: attack.summary,
                toolName: finalTurn.toolName,
                toolArguments: finalTurn.toolArguments,
                toolResponse: finalTurn.rawToolResponse,
                toolError: finalTurn.toolError,
                judgeHint: attack.judgeHint,
                priorTurns: turnResults.slice(0, -1).map((t) => ({
                  toolName: t.toolName,
                  toolArguments: t.toolArguments,
                  rawToolResponse: t.rawToolResponse,
                  toolError: t.toolError,
                })),
              }),
              {
                attackSummary: attack.summary,
                toolArguments: finalTurn.toolArguments,
                toolResponse: finalTurn.rawToolResponse,
                toolError: finalTurn.toolError,
              }
            );

        const multiResult: AttackRunResult = {
          attackId: attack.id,
          evaluatorId: attack.evaluatorId,
          toolName: finalTurn.toolName,
          toolArguments: finalTurn.toolArguments,
          rawToolResponse: finalTurn.rawToolResponse,
          toolError: finalTurn.toolError,
          judge: finalJudge,
          turns: turnResults,
        };
        runResults.push(multiResult);

        const overallVerdict = finalJudge.verdict;
        const verdictLabel =
          overallVerdict === "PASS" ? "✔ PASS" : overallVerdict === "ERROR" ? "⚠ ERROR" : "✖ FAIL";
        log.log(`  ${verdictLabel} after ${turnResults.length} turn(s)`);
        if (finalJudge.reasoning) log.log(`  ⚑ ${finalJudge.reasoning}`);
      }
    }

    // Rug-pull detection: re-list tools after attacks and diff descriptions
    log.start("Post-execution rug-pull check (re-listing tools)…");
    try {
      const postListed = await mcp.client.listTools();
      const postTools = (postListed.tools ?? []) as Array<{
        name: string;
        description?: string;
      }>;
      const initialDigest = plan.toolsDigest ?? [];
      const initialMap = new Map(initialDigest.map((t) => [t.name, t.description ?? ""]));

      let rugPullCount = 0;
      for (const tool of postTools) {
        const initialDesc = initialMap.get(tool.name);
        const currentDesc = tool.description ?? "";
        if (initialDesc !== undefined && initialDesc !== currentDesc) {
          rugPullCount++;
          const attackId = `rug-pull-${tool.name}-description-mutation`;
          log.log(`  ✖ FAIL · Tool "${tool.name}" description MUTATED after execution`);
          log.log(`    Before: ${initialDesc.slice(0, 150)}`);
          log.log(`    After:  ${currentDesc.slice(0, 150)}`);

          runResults.push({
            attackId,
            evaluatorId: "tool-description-injection",
            toolName: tool.name,
            toolArguments: { _opfor_scan: "rug_pull_diff" },
            rawToolResponse: JSON.stringify({
              content: [
                {
                  type: "text",
                  text: `Tool description mutated at runtime.\n\nBEFORE:\n${initialDesc}\n\nAFTER:\n${currentDesc}`,
                },
              ],
              isError: false,
            }),
            judge: {
              verdict: "FAIL" as const,
              score: 1,
              confidence: 100,
              evidence: currentDesc.slice(0, 500),
              reasoning: `Rug-pull detected: tool "${tool.name}" description was modified after ${plan.attacks.length} attack executions. The new description may contain injected LLM directives.`,
            },
          });
        }
      }

      if (rugPullCount === 0) {
        log.success("No tool description mutations detected.");
      } else {
        log.warn(`Rug-pull: ${rugPullCount} tool description(s) mutated after execution.`);
      }
    } catch {
      log.info("Post-execution tools/list failed (server may have disconnected).");
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
              { name: c.name, ref: c.ref ?? "", severity: c.severity },
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
        { name: c.name, ref: c.ref ?? "", severity: c.severity },
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
    .command("execute")
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
