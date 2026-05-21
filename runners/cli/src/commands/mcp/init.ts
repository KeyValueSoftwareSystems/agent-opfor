import { confirm, input, select } from "@inquirer/prompts";
import {
  McpScannerSectionSchema,
  type ProviderName,
} from "../../../../../core/dist/config/schema.js";
import { PROVIDERS, PROVIDER_CHOICES } from "../../../../../core/dist/config/types.js";
import { PROVIDER_ENV_VARS } from "../../../../../core/dist/providers/factory.js";
import { log } from "../../../../../core/dist/lib/logger.js";

function parseArgsCsv(raw: string): string[] {
  return raw
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

async function promptModelConfig(label: string) {
  const provider = await select<ProviderName>({
    message: `Which provider should the MCP scanner use for "${label}"?`,
    choices: PROVIDER_CHOICES,
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
        default: PROVIDER_ENV_VARS[provider],
        validate: (v: string) => (v.trim().length > 0 ? true : "Env var name is required"),
      })
    : undefined;

  const baseURL =
    provider === PROVIDERS.OPENAI_COMPATIBLE
      ? await input({
          message: `Base URL for Custom (OpenAI-compatible) provider (e.g. https://api.your-host.com/v1)`,
          validate: (v: string) => {
            try {
              new URL(v);
              return true;
            } catch {
              return "Please enter a valid URL";
            }
          },
        })
      : provider === PROVIDERS.AZURE
        ? await input({
            message: `Azure resource name (e.g. my-resource — from https://my-resource.openai.azure.com)`,
            validate: (v: string) => v.trim() !== "" || "Resource name is required",
          })
        : undefined;

  return {
    provider,
    model: model.trim(),
    ...(apiKeyEnv ? { apiKeyEnv: apiKeyEnv.trim() } : {}),
    ...(baseURL ? { baseURL: baseURL.trim() } : {}),
  };
}

export function buildEmptyMcpSection() {
  const mcpSection = {
    server: {
      transport: "stdio" as const,
      command: "node",
      args: ["dist/index.js"],
      env: {},
    },
    generatorModel: {
      provider: PROVIDERS.GROQ,
      model: "llama-3.3-70b-versatile",
      apiKeyEnv: "GROQ_API_KEY",
    },
    turnMode: "single" as const,
  };
  const parsed = McpScannerSectionSchema.safeParse(mcpSection);
  if (!parsed.success) {
    throw new Error("Failed to build empty MCP config section");
  }
  return parsed.data;
}

export async function collectMcpSectionInteractive() {
  log.box("Opfor MCP scanner config");
  log.info("Tip: prefer env var references for API keys (avoid committing secrets).");

  const transport = await select({
    message: "How will Opfor connect to your MCP server?",
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
  const generatorModel = await promptModelConfig("attack generation");
  const wantSeparateJudge = await confirm({
    message: "Use a different model for judging? (defaults to same as attack generation)",
    default: false,
  });
  const judgeModel = wantSeparateJudge ? await promptModelConfig("judging") : undefined;
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
    message:
      "Attacker instructions (optional — real resource IDs, attack focus areas, known weaknesses, tenant info, etc.)",
    default: "",
  });

  const mcpSection = {
    server,
    generatorModel,
    ...(judgeModel ? { judgeModel } : {}),
    turnMode,
    ...(turns !== undefined ? { turns } : {}),
    ...(notes.trim() ? { notes: notes.trim() } : {}),
    ...(attackerInstructions.trim() ? { attackerInstructions: attackerInstructions.trim() } : {}),
  };

  const sectionParsed = McpScannerSectionSchema.safeParse(mcpSection);
  if (!sectionParsed.success) {
    log.error("Config validation failed (this is a bug).");
    for (const issue of sectionParsed.error.issues)
      log.error(`${issue.path.join(".")}: ${issue.message}`);
    throw new Error("MCP config validation failed");
  }

  return sectionParsed.data;
}
