# Opfor SDK

Adversarial testing for AI systems. TypeScript-first.

## Install

```bash
npm install @agent-opfor/sdk
```

## Quick Start

### Class-based API

```typescript
import { Opfor } from "@agent-opfor/sdk";

const opfor = new Opfor({
  apiKey: process.env.ANTHROPIC_API_KEY,
});

const results = await opfor.run({
  target: {
    url: "https://api.example.com/chat",
    apiKeyEnv: "TARGET_API_KEY",
  },

  suite: "owasp-llm-top10",
});

console.log(results.score);
console.log(results.findings.length);
```

### Functional API

For those who prefer functions over classes:

```typescript
import { run, report } from "@agent-opfor/sdk";

const results = await run({
  target: {
    url: "https://api.example.com/chat",
    apiKeyEnv: "TARGET_API_KEY",
  },

  suite: "owasp-llm-top10",

  // Pass API key directly in options
  apiKey: process.env.ANTHROPIC_API_KEY,
});

console.log(results.score);

// Generate reports
await report(results).html("./report.html");
```

## Execute

Run adversarial tests against a target.

```typescript
const results = await opfor.run({
  target: {
    url: "https://api.example.com/chat",
    apiKeyEnv: "TARGET_API_KEY",
    model: "gpt-4o",
  },

  suite: "owasp-llm-top10",

  strategy: {
    effort: "adaptive",
    turns: 3,
    turnMode: "multi",
  },

  attackerModel: "claude-sonnet-4",
  judgeModel: "claude-sonnet-4",
});
```

### Suites

Predefined testing suites.

```typescript
suite: "owasp-llm-top10"; // OWASP LLM Top 10
suite: "owasp-agentic"; // Agentic AI risks
suite: "owasp-mcp"; // MCP server security
suite: "harmful-content"; // Harmful content generation
suite: "bias"; // Discrimination testing
```

### Custom Evaluators

Run specific evaluators instead of a suite.

```typescript
const results = await opfor.run({
  target: {
    url: "https://api.example.com/chat",
  },

  evaluators: ["jailbreaking", "prompt-injection", "system-prompt-leakage"],
});
```

### Autonomous Mode

Let Opfor discover attack paths automatically using an AI agent. Unlike `run()` which runs predefined evaluators, `hunt()` uses adaptive multi-turn attacks to autonomously discover vulnerabilities.

```typescript
import { hunt } from "@agent-opfor/sdk";

const results = await hunt({
  target: {
    url: "https://api.example.com/chat",
    apiKey: process.env.TARGET_API_KEY,
  },

  objective: "Find jailbreaks, data leaks, and authorization flaws",

  limits: {
    budgetUsd: 5,
  },

  onProgress: (event) => {
    if (event.type === "finding") {
      console.log(`Found: ${event.vulnClass} (${event.severity})`);
    }
  },
});

console.log(`Outcome: ${results.outcome}`);
console.log(`Findings: ${results.findings.length}`);
console.log(`Report: ${results.htmlReportPath}`);
```

Or using the class-based API:

```typescript
const opfor = new Opfor({ apiKey: process.env.ANTHROPIC_API_KEY });

const results = await opfor.hunt({
  target: { url: "https://api.example.com/chat" },
  objective: "Find jailbreaks and data leaks",
  limits: { budgetUsd: 5 },
});
```

## Targets

### HTTP Endpoint

```typescript
const results = await opfor.run({
  target: {
    url: "https://api.example.com/chat",
    name: "My Chatbot",
    description: "Customer support chatbot with access to order database",

    apiKeyEnv: "TARGET_API_KEY",
    model: "gpt-4o",

    headers: {
      "X-Custom-Header": "value",
    },

    // Request format
    requestFormat: "openai", // "auto" | "openai" | "json"

    // Custom JSON paths (for requestFormat: "json")
    promptPath: "input.message", // Where to put the prompt
    responsePath: "output.text", // Where to read response
  },

  suite: "owasp-llm-top10",
});
```

### Stateful vs Stateless

```typescript
// Stateless (default) - sends full chat history each turn
// Use for raw LLM APIs (OpenAI, Anthropic, etc.)
const results = await opfor.run({
  target: {
    url: "https://api.openai.com/v1/chat/completions",
    stateful: false,
  },
  suite: "owasp-llm-top10",
});

// Stateful - server maintains conversation history
// Use for custom chatbots with session storage
const results = await opfor.run({
  target: {
    url: "https://api.example.com/chat",
    stateful: true,
    sessionField: "session_id",
  },
  suite: "owasp-llm-top10",
});
```

### Local Script

Test a local agent script (Node.js or Python).

```typescript
const results = await opfor.run({
  target: {
    type: "local-script",
    name: "My Local Agent",
    description: "Local agent for testing",
    scriptPath: "./my-agent.js", // or .py
  },

  suite: "owasp-llm-top10",
});
```

### MCP Server

```typescript
// stdio transport
const results = await opfor.run({
  target: {
    kind: "mcp",
    name: "My MCP Server",
    transport: "stdio",
    command: "node",
    args: ["./dist/server.js"],
    env: { DEBUG: "true" },
  },

  suite: "owasp-mcp",
});

// URL transport
const results = await opfor.run({
  target: {
    kind: "mcp",
    name: "My MCP Server",
    transport: "url",
    url: "http://localhost:3000/mcp",
  },

  suite: "owasp-mcp",
});
```

## Strategy

Configure how attacks are executed.

```typescript
const results = await opfor.run({
  target: { url: "https://api.example.com/chat" },
  suite: "owasp-llm-top10",

  strategy: {
    // Effort level
    effort: "adaptive", // One sustained chat per evaluator
    // effort: "comprehensive"  // One attack per pattern in each evaluator

    // Turn configuration
    turnMode: "multi", // "single" | "multi"
    turns: 3, // Max turns per attack (for multi-turn)
  },
});
```

## Models

Configure attacker and judge LLMs.

```typescript
import { Opfor } from "@agent-opfor/sdk";

const opfor = new Opfor({
  // Default API key (used if not specified per-model)
  apiKey: process.env.ANTHROPIC_API_KEY,
});

const results = await opfor.run({
  target: { url: "https://api.example.com/chat" },
  suite: "owasp-llm-top10",

  // Attacker model (generates attacks)
  attackerModel: "claude-sonnet-4",

  // Judge model (scores responses) - defaults to attacker if not set
  judgeModel: "claude-opus-4",
});
```

### Supported Providers

```typescript
// OpenAI
attackerModel: { provider: "openai", model: "gpt-4o", apiKeyEnv: "OPENAI_API_KEY" }

// Anthropic
attackerModel: { provider: "anthropic", model: "claude-sonnet-4", apiKeyEnv: "ANTHROPIC_API_KEY" }

// Google
attackerModel: { provider: "google", model: "gemini-2.0-flash", apiKeyEnv: "GOOGLE_API_KEY" }

// Groq
attackerModel: { provider: "groq", model: "llama-3.3-70b", apiKeyEnv: "GROQ_API_KEY" }

// DeepSeek
attackerModel: { provider: "deepseek", model: "deepseek-chat", apiKeyEnv: "DEEPSEEK_API_KEY" }

// Azure OpenAI
attackerModel: {
  provider: "azure",
  model: "gpt-4o",
  apiKeyEnv: "AZURE_API_KEY",
  baseUrl: "https://my-resource.openai.azure.com"
}

// OpenAI-compatible (LiteLLM, Ollama, etc.)
attackerModel: {
  provider: "openai-compatible",
  model: "llama-3.3-70b",
  apiKeyEnv: "CUSTOM_API_KEY",
  baseUrl: "http://localhost:4000"
}
```

## Telemetry

Integrate with observability platforms.

### Langfuse

```typescript
const results = await opfor.run({
  target: { url: "https://api.example.com/chat" },
  suite: "owasp-llm-top10",

  telemetry: {
    provider: "langfuse",

    langfuse: {
      publicKeyEnv: "LANGFUSE_PUBLIC_KEY",
      secretKeyEnv: "LANGFUSE_SECRET_KEY",
      baseUrl: "https://cloud.langfuse.com",

      traceSelection: {
        lookbackHours: 24,
        environment: "production",
      },
    },

    // Enrich judge with trace data after each attack
    enrichJudgeFromTrace: true,

    // Propagate trace ID to target
    propagation: {
      headers: { "X-Trace-Id": "{{traceId}}" },
      traceIdStrategy: "per-attack",
    },
  },
});
```

### Netra

```typescript
const results = await opfor.run({
  target: { url: "https://api.example.com/chat" },
  suite: "owasp-llm-top10",

  telemetry: {
    provider: "netra",

    netra: {
      baseUrl: "http://localhost:3000",
      apiKeyEnv: "NETRA_API_KEY",

      traceSelection: {
        lookbackHours: 24,
        environment: "production",
      },
    },

    enrichJudgeFromTrace: true,
  },
});
```

## Results

```typescript
interface ExecuteResults {
  id: string;
  timestamp: string;
  targetName: string;
  targetKind: "agent" | "mcp";

  effort: "adaptive" | "comprehensive";
  attackerModel: string;
  judgeModel: string;

  score: number; // 0-100 safety score

  summary: {
    total: number;
    passed: number;
    failed: number;
    errors: number;
    safetyScore: number;
    attackSuccessRate: number;
  };

  findings: Finding[];
  evaluators: EvaluatorResult[];
}
```

### Finding

```typescript
interface Finding {
  id: string;
  evaluatorId: string;
  patternName: string;

  severity: "critical" | "high" | "medium" | "low";

  title: string;
  description: string;
  evidence?: string;

  // Standards mapping
  standards?: {
    "owasp-llm"?: string; // e.g., "LLM01"
    atlas?: string; // e.g., "AML.T0054"
  };
}
```

### EvaluatorResult

```typescript
interface EvaluatorResult {
  evaluatorId: string;
  evaluatorName: string;
  severity: string;

  standards?: Record<string, string>;

  total: number;
  passed: number;
  failed: number;
  errors: number;
  passRate: number;

  attacks: AttackResult[];
}

interface AttackResult {
  attackId: string;
  evaluatorId: string;
  patternName: string;

  prompt: string;
  response: string;

  verdict: "PASS" | "FAIL" | "ERROR";
  evidence?: string;

  // Multi-turn attacks
  turns?: {
    turnIndex: number;
    prompt: string;
    response: string;
  }[];
}
```

## Reports

Generate reports from execution results.

```typescript
// Class-based
const results = await opfor.run({
  target: { url: process.env.TARGET_URL! },
  suite: "owasp-llm-top10",
});

const r = opfor.report(results);
await r.json("./report.json");
await r.html("./report.html");

// Functional
import { run, report } from "@agent-opfor/sdk";

const results = await run({ ... });
await report(results).json("./report.json");
await report(results).html("./report.html");
```

## Evaluators

### Prompt Security

- `jailbreaking` - Bypass safety guidelines
- `prompt-injection` - Inject malicious instructions
- `system-prompt-leakage` - Extract system prompts
- `ascii-smuggling` - Unicode/encoding attacks

### Data Privacy

- `pii-direct` - Direct PII extraction
- `pii-session` - Cross-session PII leakage
- `pii-api-db` - PII via API/database access
- `sensitive-disclosure` - Sensitive data exposure

### Authorization

- `bola` - Broken Object Level Authorization
- `bfla` - Broken Function Level Authorization
- `rbac` - Role-Based Access Control bypass
- `identity-privilege-abuse` - Privilege escalation

### Agent Safety

- `agent-goal-hijack` - Redirect agent goals
- `excessive-agency` - Unauthorized actions
- `tool-misuse` - Tool exploitation
- `memory-poisoning` - Memory manipulation

### Harmful Content

- `harmful-bioweapons`
- `harmful-cybercrime-malicious-code`
- `harmful-child-exploitation`
- `harmful-violent-crime`
- `harmful-self-harm`
- ... (15 types total)

### Bias

- `bias-age`
- `bias-gender`
- `bias-race`
- `bias-disability`

### MCP Security

- `mcp-missing-authentication`
- `mcp-credential-exposure`
- `mcp-scope-escalation`
- `mcp-tool-injection-payload`
- `mcp-audit-bypass`
- ... (10 types total)

## CI Example

### Using Functional API

```typescript
import { run } from "@agent-opfor/sdk";

const results = await run({
  target: {
    url: process.env.TARGET_URL!,
    apiKeyEnv: "TARGET_API_KEY",
  },
  suite: "owasp-llm-top10",
  apiKey: process.env.ANTHROPIC_API_KEY,
});

if (results.findings.length > 0) {
  console.error(`${results.findings.length} findings detected`);

  for (const finding of results.findings) {
    console.error(`  [${finding.severity}] ${finding.title}`);
  }

  process.exit(1);
}

console.log(`Safety score: ${results.score}%`);
```

### Using Class API

```typescript
import { Opfor } from "@agent-opfor/sdk";

const opfor = new Opfor({
  apiKey: process.env.ANTHROPIC_API_KEY,
});

const results = await opfor.run({
  target: {
    url: process.env.TARGET_URL!,
    apiKeyEnv: "TARGET_API_KEY",
  },
  suite: "owasp-llm-top10",
});

if (results.findings.length > 0) {
  process.exit(1);
}
```

## Exports

### Class-based

```typescript
import { Opfor } from "@agent-opfor/sdk";

const opfor = new Opfor({ apiKey: "..." });
await opfor.run({ ... });
opfor.report(results);
```

### Functional

```typescript
import {
  run, // Run adversarial tests
  hunt, // Run autonomous red-team mode
  report, // Generate reports from results
  listSuites, // List available suites
  listEvaluators, // List available evaluators
} from "@agent-opfor/sdk";

// Execute with inline config
const results = await run({
  target: { url: "https://api.example.com/chat" },
  suite: "owasp-llm-top10",
  apiKey: process.env.ANTHROPIC_API_KEY,
});

// Generate reports
await report(results).html("./report.html");
await report(results).json("./report.json");

// Autonomous mode
const huntResults = await hunt({
  target: { url: "https://api.example.com/chat" },
  objective: "Find vulnerabilities",
  limits: { budgetUsd: 5 },
});

// List available suites
const suites = await listSuites();
// [{ id: "owasp-llm-top10", name: "OWASP LLM Top 10", evaluatorCount: 10 }, ...]

// List available evaluators
const evaluators = await listEvaluators();
// [{ id: "jailbreaking", name: "Jailbreaking", severity: "high" }, ...]
const mcpEvaluators = await listEvaluators({ kind: "mcp" });
```

### Types

```typescript
import type {
  // Execute types
  ExecuteOptions,
  ExecuteResults,
  TargetConfig,
  McpTargetConfig,
  Finding,
  EvaluatorResult,
  AttackResult,
  TelemetryConfig,
  // Autonomous mode types
  AutoOptions,
  AutoResults,
  AutoFinding,
  AutoTargetConfig,
  AutoModelsConfig,
  AutoLimitsConfig,
  AutoProgressEvent,
} from "@agent-opfor/sdk";
```

## Autonomous Mode Reference

The `hunt()` function provides programmatic access to Opfor's autonomous red-teaming capabilities.

### Options

```typescript
interface AutoOptions {
  // Target configuration (required)
  target: {
    url: string; // Target HTTP endpoint
    name?: string; // Display name
    apiKey?: string; // Bearer token
    headers?: Record<string, string>; // Extra headers
    stateful?: boolean; // true = send session id, server keeps history
    sessionField?: string; // Field name for session id
    promptPath?: string; // JSON path to write prompt
    responsePath?: string; // JSON path to read response
    model?: string; // Model value in requests
  };

  // Attack objective (required)
  objective: string;

  // Model configuration (optional)
  models?: {
    commander?: string; // Commander model (default: "opus")
    operator?: string; // Operator model (default: "sonnet")
    scout?: string; // Scout model (default: "haiku")
    verifier?: string; // Verifier model
  };

  // Limits (optional)
  limits?: {
    budgetUsd?: number; // USD budget (default: 10)
    maxOperators?: number; // Parallel operators (default: 6)
    maxTurns?: number; // Total turns (default: 120)
    maxThreadTurns?: number; // Per-thread turns (default: 25)
    maxTotalThreads?: number; // Total threads (default: 40)
    maxDepth?: number; // Exploration depth (default: 3)
    maxReconProbes?: number; // Recon probes (default: 8)
  };

  // Behavior (optional)
  verify?: boolean; // Enable verifier (default: false)
  sequential?: boolean; // Sequential operators (default: false)
  outputDir?: string; // Report output (default: ".opfor/reports")

  // Progress callback
  onProgress?: (event: AutoProgressEvent) => void;
}
```

### Results

```typescript
interface AutoResults {
  id: string;
  timestamp: string;
  target: { name: string; endpoint: string };
  objective: string;
  outcome: "achieved" | "partially-achieved" | "not-achieved" | "inconclusive";
  models: { commander: string; operator: string };
  truncated: boolean;
  truncationReason?: string;
  totalCostUsd?: number;
  summary: {
    threads: number;
    confirmed: number; // Vulnerabilities found
    defended: number; // Attacks blocked
    errors: number;
    attackSuccessRate: number;
  };
  recon: {
    fingerprint: string;
    guardrails: string[];
    weakPoints: string[];
  };
  findings: AutoFinding[];
  recommendations: string[];
  narrative: string;
  htmlReportPath?: string;
  jsonReportPath?: string;
}
```

### Progress Events

```typescript
type AutoProgressEvent =
  | { type: "line"; message: string }
  | { type: "recon_start" }
  | { type: "recon_done"; fingerprint: string; weakPoints: string[] }
  | { type: "thread_start"; threadId: string; vulnClass: string }
  | { type: "thread_turn"; threadId: string; turnIndex: number; prompt: string }
  | { type: "thread_done"; threadId: string; verdict: "PASS" | "FAIL" | "ERROR" }
  | { type: "finding"; findingId: string; vulnClass: string; severity: string }
  | { type: "complete"; outcome: string };
```

### Example with Progress Streaming

```typescript
import { hunt } from "@agent-opfor/sdk";

const results = await hunt({
  target: {
    url: "https://api.example.com/chat",
    apiKey: process.env.TARGET_API_KEY,
  },
  objective: "Find jailbreaks, prompt injection, and data exfiltration vulnerabilities",
  models: {
    commander: "opus",
    operator: "sonnet",
  },
  limits: {
    budgetUsd: 10,
    maxOperators: 4,
  },
  verify: true,
  onProgress: (event) => {
    switch (event.type) {
      case "recon_done":
        console.log(`Recon complete: ${event.fingerprint}`);
        console.log(`Weak points: ${event.weakPoints.join(", ")}`);
        break;
      case "finding":
        console.log(`🚨 Found: ${event.vulnClass} (${event.severity})`);
        break;
      case "complete":
        console.log(`Done: ${event.outcome}`);
        break;
    }
  },
});

console.log(`\n=== Results ===`);
console.log(`Outcome: ${results.outcome}`);
console.log(`Cost: $${results.totalCostUsd?.toFixed(2)}`);
console.log(`Findings: ${results.findings.length}`);
console.log(`Report: ${results.htmlReportPath}`);
```
