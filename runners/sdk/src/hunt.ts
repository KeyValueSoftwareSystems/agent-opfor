/**
 * Autonomous red-team mode for the Opfor SDK.
 *
 * Provides programmatic access to the same autonomous red-teaming capabilities
 * as `opfor hunt` CLI command.
 */

import { mkdir } from "node:fs/promises";
import path from "node:path";
import { runAutonomous } from "@keyvaluesystems/agent-opfor-core/autonomous/orchestrator/run.js";
import { writeAutonomousReport } from "@keyvaluesystems/agent-opfor-core/autonomous/report/writeReport.js";
import type {
  HuntOptions as CoreHuntOptions,
  TargetConfig as CoreTargetConfig,
  TargetMode,
} from "@keyvaluesystems/agent-opfor-core/autonomous/lib/types.js";
import type { AutonomousReport } from "@keyvaluesystems/agent-opfor-core/autonomous/report/types.js";
import type {
  HuntOptions,
  HuntResults,
  HuntFinding,
  HuntTurn,
  HuntProgressEvent,
} from "./types.js";
import { withEnvLock } from "./internal/envLock.js";

function withTempEnv(
  vars: Record<string, string | undefined>,
  fn: () => Promise<HuntResults>
): Promise<HuntResults> {
  const prev: Record<string, string | undefined> = {};
  for (const [k, v] of Object.entries(vars)) {
    prev[k] = process.env[k];
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }

  return fn().finally(() => {
    for (const [k, v] of Object.entries(prev)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  });
}

/**
 * Run autonomous red-team testing against a target.
 *
 * Unlike `run()` which runs predefined evaluators, `hunt()` uses an
 * AI agent to autonomously discover and exploit vulnerabilities through
 * adaptive multi-turn attacks.
 *
 * @example
 * ```typescript
 * import { hunt } from "@keyvaluesystems/agent-opfor-sdk";
 *
 * const results = await hunt({
 *   target: {
 *     url: "https://api.example.com/chat",
 *     apiKey: process.env.TARGET_API_KEY,
 *   },
 *   objective: "Find jailbreaks, data leaks, and authorization flaws",
 *   limits: {
 *     budgetUsd: 5,
 *   },
 *   onProgress: (event) => {
 *     if (event.type === "finding") {
 *       console.log(`Found: ${event.vulnClass} (${event.severity})`);
 *     }
 *   },
 * });
 *
 * console.log(`Outcome: ${results.outcome}`);
 * console.log(`Findings: ${results.findings.length}`);
 * ```
 */
export async function hunt(options: HuntOptions): Promise<HuntResults> {
  return await withEnvLock(async () => {
    validateOptions(options);

    const coreOptions = buildCoreOptions(options);

    await mkdir(coreOptions.outputDir, { recursive: true });

    const progressReporter = options.onProgress
      ? buildProgressReporter(options.onProgress)
      : undefined;

    const runOnce = async (): Promise<HuntResults> => {
      const report = await runAutonomous(coreOptions, {
        progress: progressReporter,
      });

      const { html, json } = await writeAutonomousReport(report, coreOptions.outputDir);

      if (options.onProgress) {
        options.onProgress({ type: "complete", outcome: report.objectiveOutcome });
      }

      return transformReport(report, html, json);
    };

    if (options.brain) {
      const baseUrl = options.brain.baseUrl?.trim();
      return withTempEnv(
        {
          ANTHROPIC_API_KEY: options.brain.apiKey,
          ANTHROPIC_BASE_URL: baseUrl ? baseUrl : undefined,
          // When a user supplies `brain`, force the run to use it (avoid falling back
          // to any ambient Claude Code / subscription credentials).
          ANTHROPIC_AUTH_TOKEN: undefined,
          CLAUDE_CODE_OAUTH_TOKEN: undefined,
        },
        runOnce
      );
    }

    return runOnce();
  });
}

function validateOptions(options: HuntOptions): void {
  if (!options.target?.url) {
    throw new Error("target.url is required");
  }

  if (!options.objective?.trim()) {
    throw new Error("objective is required");
  }

  try {
    new URL(options.target.url);
  } catch {
    throw new Error(`Invalid target URL: ${options.target.url}`);
  }
}

function buildCoreOptions(options: HuntOptions): CoreHuntOptions {
  const targetUrl = new URL(options.target.url);
  const mode: TargetMode = options.target.stateful ? "stateful" : "stateless";

  const target: CoreTargetConfig = {
    name: options.target.name ?? targetUrl.host,
    endpoint: options.target.url,
    apiKey: options.target.apiKey,
    headers: options.target.headers,
    mode,
    promptPath: options.target.promptPath,
    responsePath: options.target.responsePath,
    // resolveSessionPlan (core) already folds sessionField into session.send when
    // session is absent — pass both through and let core own that precedence.
    session: options.target.session,
    sessionField: options.target.sessionField,
    model: options.target.model,
  };

  const models = options.models ?? {};
  const limits = options.limits ?? {};

  return {
    target,
    objective: options.objective,
    commanderModel: models.commander ?? "opus",
    operatorModel: models.operator ?? "sonnet",
    scoutModel: models.scout ?? "haiku",
    verifierModel: models.verifier,
    maxOperators: limits.maxOperators ?? 6,
    maxTurns: limits.maxTurns ?? 120,
    maxThreadTurns: limits.maxThreadTurns ?? 25,
    maxTotalThreads: limits.maxTotalThreads ?? 40,
    maxForksPerThread: limits.maxForksPerThread ?? 4,
    maxTotalSends: limits.maxTotalSends,
    maxDepth: limits.maxDepth ?? 3,
    maxLeadsPerWave: limits.maxLeadsPerWave ?? 4,
    maxReconProbes: limits.maxReconProbes ?? 8,
    budgetUsd: limits.budgetUsd ?? 10,
    verify: options.verify ?? false,
    sequential: options.sequential ?? false,
    persistInventions: false,
    seedDir: undefined,
    outputDir: path.resolve(options.outputDir ?? ".opfor/reports"),
  };
}

function buildProgressReporter(onProgress: (event: HuntProgressEvent) => void): {
  onLine: (line: string) => void;
  onEvent: (event: unknown) => void;
} {
  return {
    onLine: (line: string) => {
      onProgress({ type: "line", message: line });
    },
    onEvent: (event: unknown) => {
      const e = event as Record<string, unknown>;
      switch (e.type) {
        case "recon_started":
          onProgress({ type: "recon_start" });
          break;
        case "recon_done":
          onProgress({
            type: "recon_done",
            fingerprint: String(e.fingerprint ?? ""),
            weakPoints: (e.weakPoints as string[]) ?? [],
          });
          break;
        case "thread_started":
          onProgress({
            type: "thread_start",
            threadId: String(e.threadId ?? ""),
            vulnClass: String(e.vulnClassId ?? ""),
          });
          break;
        case "turn_sent":
          onProgress({
            type: "thread_turn",
            threadId: String(e.threadId ?? ""),
            turnIndex: Number(e.turnIndex ?? 0),
            prompt: String(e.prompt ?? ""),
          });
          break;
        case "thread_done":
          onProgress({
            type: "thread_done",
            threadId: String(e.threadId ?? ""),
            verdict: (e.verdict as "PASS" | "FAIL" | "ERROR") ?? "ERROR",
          });
          break;
        case "finding_recorded":
          onProgress({
            type: "finding",
            findingId: String(e.findingId ?? ""),
            vulnClass: String(e.vulnClassId ?? ""),
            severity: String(e.severity ?? "medium"),
          });
          break;
      }
    },
  };
}

function transformReport(
  report: AutonomousReport,
  htmlPath: string,
  jsonPath: string
): HuntResults {
  return {
    id: report.reportId,
    timestamp: report.generatedAt,
    target: report.target,
    objective: report.objective,
    outcome: report.objectiveOutcome,
    models: {
      commander: report.commanderModel,
      operator: report.operatorModel,
    },
    truncated: report.truncated,
    truncationReason: report.truncationReason,
    totalCostUsd: report.totalCostUsd,
    summary: report.summary,
    recon: {
      fingerprint: report.recon.fingerprint,
      guardrails: report.recon.guardrails,
      weakPoints: report.recon.weakPoints,
    },
    findings: report.findings.map(transformFinding),
    recommendations: report.recommendations,
    narrative: report.executiveNarrative,
    htmlReportPath: htmlPath,
    jsonReportPath: jsonPath,
  };
}

function transformFinding(finding: AutonomousReport["findings"][0]): HuntFinding {
  return {
    id: finding.findingId,
    vulnClassId: finding.vulnClassId,
    name: finding.name,
    severity: finding.severity as HuntFinding["severity"],
    standards: finding.standards,
    threadId: finding.threadId,
    strategy: finding.strategy,
    personas: finding.personaArc,
    verdict: finding.verdict,
    confidence: finding.confidence,
    evidence: finding.evidence,
    reasoning: finding.reasoning,
    turns: finding.turns.map(transformTurn),
  };
}

function transformTurn(turn: AutonomousReport["findings"][0]["turns"][0]): HuntTurn {
  return {
    turnIndex: turn.turnIndex,
    prompt: turn.prompt,
    response: turn.response,
    persona: turn.persona,
    strategy: turn.strategy,
    score: turn.score,
  };
}
