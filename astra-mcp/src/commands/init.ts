import path from "node:path";
import { Command } from "commander";
import { confirm, input, select } from "@inquirer/prompts";
import { AstraMcpConfigSchema, type AstraMcpConfig, type ProviderName } from "../config/schema.js";
import { fileExists, writeJsonFile } from "../lib/jsonFile.js";
import { log } from "../lib/logger.js";

function defaultApiKeyEnv(provider: ProviderName): string {
  switch (provider) {
    case "openai":
      return "OPENAI_API_KEY";
    case "anthropic":
      return "ANTHROPIC_API_KEY";
    case "groq":
      return "GROQ_API_KEY";
    case "google":
      return "GOOGLE_GENERATIVE_AI_API_KEY";
    case "other":
      return "ASTRA_API_KEY";
  }
  // Fallback for unexpected values (should be unreachable).
  return "ASTRA_API_KEY";
}

function parseArgsCsv(raw: string): string[] {
  return raw
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

async function promptModelConfig(label: "setup" | "run") {
  const provider = await select<ProviderName>({
    message: `Which provider should astra-mcp use for "${label}"?`,
    choices: [
      { name: "OpenAI", value: "openai" as const },
      { name: "Anthropic", value: "anthropic" as const },
      { name: "Groq", value: "groq" as const },
      { name: "Google", value: "google" as const },
      { name: "Other (OpenAI-compatible)", value: "other" as const },
    ],
  });

  const model = await input({
    message: `Model name for "${label}" (e.g. gpt-4o-mini, llama-3.3-70b-versatile)`,
    validate: (v: string) => (v.trim().length > 0 ? true : "Model name is required"),
  });

  const storeKeyAsEnv = await confirm({
    message: `Store API key as an env var reference for "${label}" (recommended)?`,
    default: true,
  });

  const apiKeyEnv = storeKeyAsEnv
    ? await input({
        message: `Env var name for "${label}" API key`,
        default: defaultApiKeyEnv(provider),
        validate: (v: string) => (v.trim().length > 0 ? true : "Env var name is required"),
      })
    : undefined;

  const baseURL =
    provider === "other"
      ? await input({
          message: `Base URL for OpenAI-compatible provider (e.g. https://api.your-host.com/v1)`,
          validate: (v: string) => {
            try {
              // eslint-disable-next-line no-new
              new URL(v);
              return true;
            } catch {
              return "Please enter a valid URL";
            }
          },
        })
      : undefined;

  return {
    provider,
    model: model.trim(),
    ...(apiKeyEnv ? { apiKeyEnv: apiKeyEnv.trim() } : {}),
    ...(baseURL ? { baseURL: baseURL.trim() } : {}),
  };
}

export function registerInitCommand(program: Command) {
  program
    .command("init")
    .description("Interactive wizard to create astra-mcp.config.json")
    .option("-o, --out <path>", "Output path for config file", "astra-mcp.config.json")
    .action(async ({ out }: { out: string }) => {
      const outPath = path.resolve(out);

      log.box("Astra MCP config wizard");
      log.info("This will create a config file for your MCP server + model settings.");
      log.info("Tip: prefer env var references for API keys (avoid committing secrets).");

      if (await fileExists(outPath)) {
        const ok = await confirm({
          message: `File already exists at ${outPath}. Overwrite?`,
          default: false,
        });
        if (!ok) {
          log.info("Cancelled. No changes made.");
          return;
        }
      }

      const transport = await select({
        message: "How will astra-mcp connect to your MCP server?",
        choices: [
          { name: "Local process (stdio) — recommended", value: "stdio" as const },
          { name: "Remote URL (http/sse/websocket) — if your host supports it", value: "url" as const },
        ],
      });

      const server =
        transport === "stdio"
          ? await (async () => {
              const serverCommand = await input({
                message: "MCP server command to run",
                default: "node",
                validate: (v: string) => (v.trim().length > 0 ? true : "Command is required"),
              });

              const serverArgsRaw = await input({
                message: "MCP server args (comma-separated)",
                default: "dist/index.js",
              });

              const serverCwd = await input({
                message: "Working directory for the MCP server (optional)",
                default: "",
              });

              const addEnv = await confirm({
                message: "Add environment variables for the MCP server process?",
                default: false,
              });

              const env: Record<string, string> = {};
              if (addEnv) {
                // Simple first pass: ask for one line of KEY=VALUE pairs.
                // We can evolve this to a repeatable prompt loop later.
                const envRaw = await input({
                  message: "Enter env vars as KEY=VALUE pairs (comma-separated)",
                  default: "",
                });
                for (const pair of parseArgsCsv(envRaw)) {
                  const idx = pair.indexOf("=");
                  if (idx <= 0) continue;
                  const k = pair.slice(0, idx).trim();
                  const v = pair.slice(idx + 1).trim();
                  if (k) env[k] = v;
                }
              }

              return {
                transport: "stdio" as const,
                command: serverCommand.trim(),
                args: parseArgsCsv(serverArgsRaw),
                ...(serverCwd.trim() ? { cwd: serverCwd.trim() } : {}),
                env,
              };
            })()
          : await (async () => {
              const url = await input({
                message: "MCP server URL",
                default: "http://localhost:3000/mcp",
                validate: (v: string) => {
                  try {
                    // eslint-disable-next-line no-new
                    new URL(v);
                    return true;
                  } catch {
                    return "Please enter a valid URL";
                  }
                },
              });

              const addHeaders = await confirm({
                message: "Add headers for MCP requests? (e.g. Authorization)",
                default: false,
              });

              const headers: Record<string, string> = {};
              if (addHeaders) {
                const raw = await input({
                  message: "Enter headers as KEY=VALUE pairs (comma-separated)",
                  default: "",
                });
                for (const pair of parseArgsCsv(raw)) {
                  const idx = pair.indexOf("=");
                  if (idx <= 0) continue;
                  const k = pair.slice(0, idx).trim();
                  const v = pair.slice(idx + 1).trim();
                  if (k) headers[k] = v;
                }
              }

              return {
                transport: "url" as const,
                url: url.trim(),
                headers,
              };
            })();

      log.start("Configuring model settings…");
      const setupModel = await promptModelConfig("setup");
      const runModel = await promptModelConfig("run");
      log.success("Model settings captured.");

      const turnMode = await select<"single" | "multi">({
        message: "Attack turn mode",
        choices: [
          { name: "Single-turn — one shot per attack (faster, default)", value: "single" as const },
          { name: "Multi-turn — attacker adapts based on judge feedback", value: "multi" as const },
        ],
      });

      let turns: number | undefined;
      if (turnMode === "multi") {
        const turnsRaw = await input({
          message: "Number of adaptive turns per attack (2–10)",
          default: "3",
          validate: (v: string) => {
            const n = parseInt(v, 10);
            return Number.isFinite(n) && n >= 2 && n <= 10 ? true : "Enter a number between 2 and 10";
          },
        });
        turns = parseInt(turnsRaw, 10);
      }

      const notes = await input({
        message: "Any notes to include in the config? (optional)",
        default: "",
      });

      const attackerInstructions = await input({
        message: "Attacker instructions (optional — real resource IDs, attack focus areas, known weaknesses, tenant info, etc.)",
        default: "",
      });

      const cfg: AstraMcpConfig = {
        schemaVersion: 2,
        server,
        models: {
          setup: setupModel,
          run: runModel,
        },
        turnMode,
        ...(turns !== undefined ? { turns } : {}),
        ...(notes.trim() ? { notes: notes.trim() } : {}),
        ...(attackerInstructions.trim() ? { attackerInstructions: attackerInstructions.trim() } : {}),
      };

      const parsed = AstraMcpConfigSchema.safeParse(cfg);
      if (!parsed.success) {
        log.error("Config validation failed (this is a bug).");
        for (const issue of parsed.error.issues) log.error(`${issue.path.join(".")}: ${issue.message}`);
        process.exitCode = 1;
        return;
      }

      await writeJsonFile(outPath, parsed.data);

      log.success(`Created config at: ${outPath}`);
      log.info("You can edit this file any time to add extra settings.");
    });
}

