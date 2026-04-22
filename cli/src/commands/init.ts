import type { Command } from "commander";
import { writeFile } from "node:fs/promises";
import type { SetupConfigFile } from "@astra/core/config/types";

const SAMPLE_CONFIG: SetupConfigFile = {
  llm: {
    provider: "openai",
    model: "gpt-4o-mini",
    apiKey: "",
    // baseURL: ""  — only for provider "other" (OpenAI-compatible endpoint)
  },
  target: {
    name: "My AI Agent",
    description: "Describe your application here. Include: what it does, types of users, sensitive data it handles, dangerous actions it can perform, topics it should never discuss.",
    type: "http-endpoint",
    endpoint: "http://localhost:4000/chat",
    requestFormat: "openai",
    targetModel: "gpt-4o-mini",
    // targetApiKey: ""  — Bearer token for target endpoint (optional)
    // functionSignature: ""  — only for type "python-function"
  },
  selection: {
    mode: "suite",
    suite: "owasp-llm-top10",
    // To pick individual evaluators instead:
    // mode: "evaluators",
    // evaluators: ["prompt-injection", "jailbreaking", "sensitive-disclosure"]
  },
};

export function registerInitCommand(program: Command): void {
  program
    .command("init")
    .description("Generate a sample astra.config.json config file")
    .option("-o, --output <path>", "Output file path", "astra.config.json")
    .action(async (opts) => {
      try {
        await writeFile(opts.output, JSON.stringify(SAMPLE_CONFIG, null, 2), "utf8");
        console.log(`\nConfig template written to: ${opts.output}`);
        console.log(`Edit it, then run: astra setup --config ${opts.output}\n`);
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        console.error(`Error writing config: ${msg}`);
        process.exitCode = 1;
      }
    });
}
