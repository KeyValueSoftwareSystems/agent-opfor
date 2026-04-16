#!/usr/bin/env node

const { spawn } = require("child_process");
const { resolve } = require("path");
const { existsSync } = require("fs");

// Parse CLI arguments
const args = process.argv.slice(2);

let configPath = null;
let outputPath = null;
let failOnSeverity = null;
let skillsBasePath = resolve(__dirname, "../../skills");
let provider = process.env.ASTRA_PROVIDER || "claude"; // default to claude
let suite = null;
let evaluators = null;
let help = false;

for (let i = 0; i < args.length; i++) {
  const arg = args[i];
  if (arg === "--config" && i + 1 < args.length) {
    configPath = args[++i];
  } else if (arg === "--output" && i + 1 < args.length) {
    outputPath = args[++i];
  } else if (arg === "--fail-on" && i + 1 < args.length) {
    failOnSeverity = args[++i];
  } else if (arg === "--suite" && i + 1 < args.length) {
    suite = args[++i];
  } else if (arg === "--evaluators" && i + 1 < args.length) {
    evaluators = args[++i]; // comma-separated
  } else if (arg === "--provider" && i + 1 < args.length) {
    provider = args[++i];
  } else if (arg === "--skills" && i + 1 < args.length) {
    skillsBasePath = args[++i];
  } else if (arg === "--help" || arg === "-h") {
    help = true;
  }
}

if (help) {
  console.log(`
astra CLI

Usage:
  astra run --config <path> [OPTIONS]

Options:
  --config <path>        Config file to use (required)
  --output <path>        Output report path (optional)
  --fail-on <severity>   Exit with code 1 if finding >= severity (critical, high, medium, low)
  --suite <name>         Override: run specific suite (e.g., owasp-llm-top10)
  --evaluators <list>    Override: run specific evaluators (comma-separated: jailbreaking,prompt-injection)
  --provider <name>      LLM provider to use (claude, openai, ollama, etc.) [default: claude]
  --skills <path>        Skills directory [default: ./skills/]
  --help                 Show this help

Environment:
  ASTRA_PROVIDER         Default provider if --provider not specified

Examples:
  astra run --config astra.config.md --provider claude
  astra run --config astra.config.md --suite owasp-llm-top10 --provider openai
  astra run --config astra.config.md --evaluators jailbreaking,prompt-injection --provider ollama
  astra run --config astra.config.md --fail-on critical --output results/report.md
`);
  process.exit(0);
}

if (!configPath) {
  console.error(
    "Error: --config is required. Use --help for usage information."
  );
  process.exit(1);
}

// Resolve absolute paths
configPath = resolve(configPath);
skillsBasePath = resolve(skillsBasePath);

if (!existsSync(configPath)) {
  console.error(`Error: Config file not found: ${configPath}`);
  process.exit(1);
}

if (!existsSync(skillsBasePath)) {
  console.error(`Error: Skills directory not found: ${skillsBasePath}`);
  process.exit(1);
}

// Validate provider
const supportedProviders = ["claude", "openai", "ollama", "anthropic"];
if (!supportedProviders.includes(provider)) {
  console.warn(
    `Warning: Provider "${provider}" may not be supported. Continuing anyway.`
  );
}

// Build prompt for agent
let prompt = `Read the skill at ${skillsBasePath}/red-team-run/SKILL.md. Execute a full red team assessment.

Config file: ${configPath}
Skills base path: ${skillsBasePath}/red-team-run
Provider: ${provider}`;

if (suite) {
  prompt += `\nOverride suite: run "${suite}"`;
}

if (evaluators) {
  prompt += `\nOverride evaluators: run "${evaluators}" (comma-separated)`;
}

if (outputPath) {
  prompt += `\nAfter generating the markdown report, also output the final report as JSON to: ${outputPath}`;
}

if (failOnSeverity) {
  prompt += `\nExit criteria: fail with exit code 1 if any finding with severity >= ${failOnSeverity} is found.`;
}

console.log(`Starting red team assessment...`);
console.log(`  Provider: ${provider}`);
console.log(`  Config: ${configPath}`);
if (suite) console.log(`  Suite: ${suite}`);
if (evaluators) console.log(`  Evaluators: ${evaluators}`);
console.log();

// Route to appropriate agent based on provider
invokeAgent(provider, prompt);

function invokeAgent(provider, prompt) {
  let cmd, cmdArgs, stdio;

  switch (provider) {
    case "claude":
    case "anthropic":
      // Use Claude Code CLI
      cmd = "claude";
      cmdArgs = ["-p", prompt, "--allowedTools", "Bash,Read,Write"];
      stdio = "inherit";
      break;

    case "openai":
      // For OpenAI, we'd use a wrapper or API client
      // This is a stub - actual implementation would invoke OpenAI API
      console.warn(
        "OpenAI provider is not yet fully implemented. Please use --provider claude for now."
      );
      process.exit(1);

    case "ollama":
      // For Ollama (local LLM), similar approach
      console.warn(
        "Ollama provider is not yet fully implemented. Please use --provider claude for now."
      );
      process.exit(1);

    default:
      console.error(`Unknown provider: ${provider}`);
      process.exit(1);
  }

  const agent = spawn(cmd, cmdArgs, {
    stdio: stdio,
    shell: true,
  });

  agent.on("close", (code) => {
    if (code !== 0) {
      console.error(`\nAgent process exited with code ${code}`);
      process.exit(code);
    } else {
      console.log("\nRed team assessment completed successfully.");
      process.exit(0);
    }
  });

  agent.on("error", (err) => {
    console.error(`Failed to start agent: ${err.message}`);
    if (provider === "claude") {
      console.error(
        "Make sure Claude Code is installed and 'claude' command is available."
      );
      console.error("Install from: https://claude.com/claude-code");
    }
    process.exit(1);
  });
}
