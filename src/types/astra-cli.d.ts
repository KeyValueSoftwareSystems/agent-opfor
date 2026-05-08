declare module "astra-cli" {
  import type { Command } from "commander";
  export function registerAgentCli(program: Command): void;
  export function buildEmptyAgentSetupConfig(): Record<string, unknown>;
  export function collectAgentSetupConfigInteractive(): Promise<Record<string, unknown>>;
  export function generateAgentAttacksFromConfig(opts: {
    configPath: string;
    outputPath: string;
    configId?: string;
  }): Promise<string>;
  export function runAgentAttacksFromFile(opts: {
    input: string;
    targetScript?: string;
    outputDir?: string;
    concurrency?: string;
  }): Promise<{ html: string; json: string }>;
}
