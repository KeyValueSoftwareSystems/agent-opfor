import { run } from "./run.js";
import { report, type ReportBuilder } from "./report.js";
import type { OpforOptions, RunOptions, RunResults, HuntOptions, HuntResults } from "./types.js";

/**
 * Opfor SDK client class.
 *
 * Provides a stateful wrapper around the functional API for convenience.
 *
 * @example
 * ```typescript
 * const opfor = new Opfor({ apiKey: process.env.ANTHROPIC_API_KEY });
 *
 * const results = await opfor.run({
 *   target: { url: "https://api.example.com/chat" },
 *   suite: "owasp-llm-top10",
 * });
 *
 * await opfor.report(results).html("./report.html");
 * ```
 */
export class Opfor {
  private readonly options: OpforOptions;

  constructor(options: OpforOptions = {}) {
    this.options = options;

    if (options.apiKey) {
      process.env.ANTHROPIC_API_KEY = options.apiKey;
    }
  }

  /**
   * Run adversarial tests against a target.
   */
  async run(options: Omit<RunOptions, "apiKey">): Promise<RunResults> {
    const fullOptions: RunOptions = {
      ...options,
      apiKey: this.options.apiKey,
      attackerModel: options.attackerModel ?? this.options.attackerModel,
      judgeModel: options.judgeModel ?? this.options.judgeModel,
    };

    return run(fullOptions);
  }

  /**
   * Run autonomous red-team testing against a target.
   *
   * Unlike `run()` which runs predefined evaluators, `hunt()` uses an
   * AI agent to autonomously discover and exploit vulnerabilities.
   *
   * @example
   * ```typescript
   * const results = await opfor.hunt({
   *   target: { url: "https://api.example.com/chat" },
   *   objective: "Find jailbreaks and data leaks",
   *   limits: { budgetUsd: 5 },
   * });
   * ```
   */
  async hunt(options: HuntOptions): Promise<HuntResults> {
    // Lazy import to avoid loading @anthropic-ai/claude-agent-sdk unless needed
    const { hunt } = await import("./hunt.js");
    return hunt(options);
  }

  /**
   * Generate reports from execution results.
   */
  report(results: RunResults): ReportBuilder {
    return report(results);
  }
}
