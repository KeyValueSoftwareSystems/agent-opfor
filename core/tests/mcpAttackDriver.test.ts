/**
 * PR8 — McpAttackDriver characterization.
 *
 * The MCP attack loop had no test coverage before it was extracted from runAll
 * into an AttackDriver. These pin the behaviors that must be preserved: the
 * empty-tool short-circuit, a single-turn call → judge → result, the multi-turn
 * per-turn judge that early-stops on the first FAIL, and the continuation path
 * where a PASS turn runs the turn generator and the loop judges the last turn.
 *
 * A fake target plus a local server exercise the loop without a real MCP server
 * or attacker LLM: the server backs both the judge and the attacker turn
 * generator on one endpoint, routing by a marker unique to the generator prompt.
 */
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { createServer, type Server } from "node:http";
import { setEnvProvider } from "../src/lib/env.js";

setEnvProvider(() => "fake-test-api-key");

interface ServerState {
  server: Server;
  port: number;
  llmCalls: number;
  /** Requests routed to the MCP turn generator (buildTurn's turn>1 branch). */
  turnGenCalls: number;
  nextVerdict: "PASS" | "FAIL";
  reset(verdict: "PASS" | "FAIL"): void;
}

let srv: ServerState;

/** Wrap a model's completion text in an OpenAI chat.completion envelope. */
function chatCompletion(content: string): string {
  return JSON.stringify({
    id: "t",
    object: "chat.completion",
    created: 0,
    model: "m",
    choices: [{ index: 0, message: { role: "assistant", content }, finish_reason: "stop" }],
    usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
  });
}

function judgeJson(verdict: "PASS" | "FAIL"): string {
  const body =
    verdict === "FAIL"
      ? { verdict: "FAIL", score: 2, confidence: 90, evidence: "AKIA", reasoning: "leaked" }
      : { verdict: "PASS", score: 10, confidence: 90, evidence: "N/A", reasoning: "safe" };
  return chatCompletion(JSON.stringify(body));
}

/** The attacker's next-turn generator expects a JSON object with args + judgeHint. */
function turnGenJson(): string {
  return chatCompletion(
    JSON.stringify({ args: { q: "escalated" }, judgeHint: "probe the boundary" })
  );
}

// Unique marker in generateNextMcpTurn's prompt — lets the fake server tell a
// turn-generation request apart from a judge request on the shared endpoint.
const TURN_GEN_MARKER = "escalate the attack";

before(async () => {
  srv = await new Promise<ServerState>((resolve) => {
    let llmCalls = 0;
    let turnGenCalls = 0;
    let nextVerdict: "PASS" | "FAIL" = "PASS";
    const server = createServer((req, res) => {
      let body = "";
      req.on("data", (c: Buffer) => (body += c.toString()));
      req.on("end", () => {
        if ((req.url ?? "").startsWith("/v1/chat/completions")) {
          llmCalls++;
          res.writeHead(200, { "Content-Type": "application/json" });
          // One endpoint backs both the attacker turn generator and the judge;
          // route by the attacker prompt's unique marker.
          if (body.includes(TURN_GEN_MARKER)) {
            turnGenCalls++;
            res.end(turnGenJson());
          } else {
            res.end(judgeJson(nextVerdict));
          }
          return;
        }
        res.writeHead(404);
        res.end("no");
      });
    });
    server.listen(0, "127.0.0.1", () => {
      const { port } = server.address() as { port: number };
      resolve({
        server,
        port,
        get llmCalls() {
          return llmCalls;
        },
        get turnGenCalls() {
          return turnGenCalls;
        },
        get nextVerdict() {
          return nextVerdict;
        },
        set nextVerdict(v) {
          nextVerdict = v;
        },
        reset(v) {
          llmCalls = 0;
          turnGenCalls = 0;
          nextVerdict = v;
        },
      });
    });
  });
});

after(async () => {
  await new Promise<void>((resolve, reject) =>
    srv.server.close((e) => (e ? reject(e) : resolve()))
  );
});

const { runMcpAttack } = await import("../src/execute/mcpAttackDriver.js");
const { createModel } = await import("../src/providers/factory.js");
type FakeTarget = Parameters<typeof runMcpAttack>[1];

function fakeTarget(toolResponse: string): FakeTarget {
  return {
    async callTool() {
      return { response: toolResponse };
    },
    async listTools() {
      return [];
    },
    async listResources() {
      return [];
    },
    async readResource() {
      return "";
    },
    async close() {},
  };
}

/** Narrow driver deps: [attackModel, judgeLlm] both pointed at the local server. */
function deps() {
  const llm = {
    provider: "openai-compatible" as const,
    model: "m",
    apiKeyEnv: "K",
    baseURL: `http://127.0.0.1:${srv.port}/v1`,
  };
  return [createModel(llm), llm] as const;
}

function mcpAttack(overrides: Record<string, unknown> = {}) {
  return {
    kind: "mcp" as const,
    id: "att-1",
    evaluatorId: "e1",
    evaluatorName: "Eval",
    severity: "high",
    patternName: "pattern",
    passCriteria: "defended",
    failCriteria: "leaked",
    turns: 1,
    toolName: "lookup",
    toolArguments: { q: "x" },
    ...overrides,
  };
}

test("empty toolName short-circuits to an ERROR result without any LLM call", async () => {
  srv.reset("PASS");
  const result = await runMcpAttack(mcpAttack({ toolName: "" }), fakeTarget("unused"), ...deps());
  assert.strictEqual(result.kind, "mcp");
  assert.strictEqual(result.judge.verdict, "ERROR");
  assert.strictEqual(result.judge.errorMessage, "no toolName in attack spec");
  assert.strictEqual(srv.llmCalls, 0);
});

test("single-turn attack calls the tool, judges once, and assembles the result", async () => {
  srv.reset("PASS");
  const result = await runMcpAttack(mcpAttack(), fakeTarget("all good"), ...deps());
  assert.strictEqual(result.kind, "mcp");
  assert.strictEqual(result.judge.verdict, "PASS");
  assert.strictEqual(result.kind === "mcp" ? result.toolResponse : undefined, "all good");
  assert.strictEqual(result.kind === "mcp" ? result.toolName : undefined, "lookup");
  assert.strictEqual(result.turns, undefined); // single turn → not recorded as a turn list
  assert.strictEqual(srv.llmCalls, 1); // final judge only
});

test("multi-turn attack early-stops on the first FAIL (no turn-2 generator call)", async () => {
  srv.reset("FAIL");
  const result = await runMcpAttack(
    mcpAttack({ turns: 2 }),
    fakeTarget("leaked AKIA key here"),
    ...deps()
  );
  assert.strictEqual(result.judge.verdict, "FAIL");
  // Exactly one LLM call — the mid-turn judge at turn 1. Turn 2 (generator +
  // final judge) never runs, proving the early stop.
  assert.strictEqual(srv.llmCalls, 1);
});

test("multi-turn attack continues past a PASS turn — runs the turn-2 generator, then judges the last turn", async () => {
  srv.reset("PASS");
  let toolCalls = 0;
  const target: FakeTarget = {
    async callTool() {
      toolCalls++;
      return { response: `turn ${toolCalls} response` };
    },
    async listTools() {
      return [];
    },
    async listResources() {
      return [];
    },
    async readResource() {
      return "";
    },
    async close() {},
  };

  const result = await runMcpAttack(mcpAttack({ turns: 2 }), target, ...deps());

  assert.strictEqual(result.judge.verdict, "PASS");
  // Turn 1's mid-judge PASSed, so the loop continued: buildTurn's turn>1 branch
  // called the generator, and both turns hit the tool.
  assert.strictEqual(srv.turnGenCalls, 1);
  assert.strictEqual(toolCalls, 2);
  // Multi-turn attack records the full turn list; the final result surfaces the
  // last turn's response (judged once at the end).
  assert.strictEqual(result.turns?.length, 2);
  assert.strictEqual(result.kind === "mcp" ? result.toolResponse : undefined, "turn 2 response");
  // Turn-1 mid judge + turn-2 generator + turn-2 final judge = 3 LLM calls.
  assert.strictEqual(srv.llmCalls, 3);
});
