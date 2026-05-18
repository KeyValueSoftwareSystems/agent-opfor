import path from "node:path";
import { readFile } from "node:fs/promises";
import { connectMcpClient } from "../../../core/dist/mcp-client/createClient.js";
import { executeAttack } from "../../../core/dist/run/executeAttack.js";
import {
  judgeToolResponse,
  sanitizeJudgeResult,
  errorJudge,
} from "../../../core/dist/run/judge.js";
import { generateNextMcpAttackTurn } from "../../../core/dist/run/generateNextMcpAttackTurn.js";
import type { ToolCallTurn } from "../../../core/dist/run/generateNextMcpAttackTurn.js";
import { loadEvaluatorCriteria } from "../../../core/dist/catalog/loadEvaluatorCriteria.js";
import { buildReport, enrichReportWithCriteria } from "../../../core/dist/report/buildReport.js";
import { writeHtmlReport } from "../../../core/dist/report/renderHtml.js";
import { scanResources } from "../../../core/dist/run/scanResources.js";
import type { AttackPlanWritten } from "../../../core/dist/attacks/planSchema.js";
import type { AttackRunResult, TurnRecord } from "../../../core/dist/run/types.js";

export interface McpExecuteOptions {
  inputPath: string;
  outputDir?: string;
}

export interface McpExecuteResult {
  safetyScore: number;
  total: number;
  passed: number;
  failed: number;
  errors: number;
  rugPullCount: number;
  htmlReport: string;
  jsonReport: string;
  failedAttacks: Array<{
    evaluatorId: string;
    toolName: string;
    score: number;
    reasoning: string;
  }>;
}

export async function runMcpExecute(opts: McpExecuteOptions): Promise<McpExecuteResult> {
  const { inputPath, outputDir = ".opfor/reports" } = opts;

  const planRaw = await readFile(path.resolve(inputPath), "utf8");
  const plan = JSON.parse(planRaw) as AttackPlanWritten;

  if (!plan.server) {
    throw new Error(
      "Attack plan is missing embedded server config. " +
        "Re-run opfor_mcp_setup to regenerate the plan."
    );
  }
  if (!plan.generatorModel) {
    throw new Error(
      "Attack plan is missing embedded generator model config. " +
        "Re-run opfor_mcp_setup to regenerate the plan."
    );
  }

  const judgeModelCfg = plan.judgeModel ?? plan.generatorModel;

  const evaluatorIds = [...new Set(plan.attacks.map((a) => a.evaluatorId))];
  const criteriaMap = new Map(
    await Promise.all(
      evaluatorIds.map(async (id) => [id, await loadEvaluatorCriteria(id)] as const)
    )
  );

  const resolvedOutDir = path.resolve(outputDir);
  const mcp = await connectMcpClient(plan.server);

  const runResults: AttackRunResult[] = [];
  const unauthServerUrl = plan.server.transport !== "stdio" ? plan.server.url : undefined;

  // Phase 0: Resource scan
  const scanEnabled = (plan as Record<string, unknown>).scanResources !== false;
  if (scanEnabled) {
    const resourceScan = await scanResources(mcp);
    if (resourceScan.resources.length > 0) {
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

        if (res.readError) {
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

  let rugPullCount = 0;

  try {
    for (let i = 0; i < plan.attacks.length; i++) {
      const attack = plan.attacks[i];
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

        runResults.push({ ...execResult, judge: judgeResult });
      } else {
        const turnHistory: ToolCallTurn[] = [];
        const turnResults: TurnRecord[] = [];

        for (let t = 1; t <= numTurns; t++) {
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

          if (judgeResult.verdict !== "PASS") break;
        }

        const finalTurn = turnResults[turnResults.length - 1];
        runResults.push({
          attackId: attack.id,
          evaluatorId: attack.evaluatorId,
          toolName: finalTurn.toolName,
          toolArguments: finalTurn.toolArguments,
          rawToolResponse: finalTurn.rawToolResponse,
          toolError: finalTurn.toolError,
          judge: finalTurn.judge,
          turns: turnResults,
        });
      }
    }

    // Rug-pull detection: re-list tools after attacks and diff descriptions
    try {
      const postListed = await mcp.client.listTools();
      const postTools = (postListed.tools ?? []) as Array<{
        name: string;
        description?: string;
      }>;
      const initialDigest = plan.toolsDigest ?? [];
      const initialMap = new Map(initialDigest.map((t) => [t.name, t.description ?? ""]));

      for (const tool of postTools) {
        const initialDesc = initialMap.get(tool.name);
        const currentDesc = tool.description ?? "";
        if (initialDesc !== undefined && initialDesc !== currentDesc) {
          rugPullCount++;
          runResults.push({
            attackId: `rug-pull-${tool.name}-description-mutation`,
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
    } catch {
      // Post-execution tools/list failed — server may have disconnected
    }
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

  const failedAttacks = runResults
    .filter((r) => r.judge.verdict === "FAIL")
    .map((r) => ({
      evaluatorId: r.evaluatorId,
      toolName: r.toolName,
      score: r.judge.score,
      reasoning: r.judge.reasoning,
    }));

  return {
    safetyScore: report.summary.safetyScore,
    total: report.summary.total,
    passed: report.summary.passed,
    failed: report.summary.failed,
    errors: report.summary.errors,
    rugPullCount,
    htmlReport: paths.html,
    jsonReport: paths.json,
    failedAttacks,
  };
}
