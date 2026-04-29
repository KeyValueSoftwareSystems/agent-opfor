import path from "node:path";
import { readFile } from "node:fs/promises";
import { Command } from "commander";
import { DEFAULT_ASTRA_MCP_CONFIG, requireAstraMcpConfig } from "../lib/astraConfig.js";
import { loadAstraMcpConfigFile } from "../lib/loadAstraMcpConfig.js";
import { log } from "../lib/logger.js";
import { connectMcpClient } from "../mcp/createClient.js";
import { executeAttack } from "../run/executeAttack.js";
import { judgeToolResponse, sanitizeJudgeResult } from "../run/judge.js";
import { loadEvaluatorCriteria } from "../catalog/loadEvaluatorCriteria.js";
import { buildReport, enrichReportWithCriteria } from "../report/buildReport.js";
import { writeHtmlReport } from "../report/renderHtml.js";
import type { AttackPlanWritten } from "../attacks/planSchema.js";
import type { AttackRunResult } from "../run/types.js";

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

            const execResult = await executeAttack(mcp, attack);

            const criteria = criteriaMap.get(attack.evaluatorId);
            if (!criteria) throw new Error(`No criteria loaded for evaluator: ${attack.evaluatorId}`);

            const rawJudgeResult = await judgeToolResponse({
              model: cfg.models.run,
              evaluator: criteria,
              attackSummary: attack.summary,
              toolName: execResult.toolName,
              toolArguments: execResult.toolArguments,
              toolResponse: execResult.rawToolResponse,
              toolError: execResult.toolError,
              steps: execResult.steps,
            });

            const judgeResult = sanitizeJudgeResult(rawJudgeResult, {
              attackSummary: attack.summary,
              toolArguments: execResult.toolArguments,
              toolResponse: execResult.rawToolResponse,
              toolError: execResult.toolError,
              steps: execResult.steps,
            });

            runResults.push({ ...execResult, judge: judgeResult });

            const verdict = judgeResult.verdict === "PASS" ? "✔ PASS" : "✖ FAIL";
            log.log(`  ${verdict} · score ${judgeResult.score}/10 · confidence ${judgeResult.confidence}%`);

            // Log each step for multi-turn, or the single call otherwise
            if (execResult.steps && execResult.steps.length > 1) {
              for (const step of execResult.steps) {
                log.log(`  ↑ step ${step.stepIndex + 1}  ${step.toolName}`);
                log.log(`         ${JSON.stringify(step.toolArguments, null, 2)}`);
                if (step.toolError) {
                  log.log(`  ↓ err  ${step.toolError}`);
                } else {
                  const { text, isError } = parseToolResponse(step.rawToolResponse);
                  const errorTag = isError ? " [isError=true]" : "";
                  log.log(`  ↓ res${errorTag}  ${text.slice(0, 300)}`);
                }
              }
            } else {
              log.log(`  ↑ req  ${execResult.toolName}`);
              log.log(`         ${JSON.stringify(execResult.toolArguments, null, 2)}`);
              if (execResult.toolError) {
                log.log(`  ↓ err  ${execResult.toolError}`);
              } else {
                const { text, isError } = parseToolResponse(execResult.rawToolResponse);
                const errorTag = isError ? " [isError=true]" : "";
                log.log(`  ↓ res${errorTag}  ${text.slice(0, 300)}`);
              }
            }

            if (judgeResult.reasoning) log.log(`  ⚑ ${judgeResult.reasoning}`);
          }
        } catch (runErr: unknown) {
          // Write partial report before re-throwing so results so far are not lost
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
          await mcp.close();
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
