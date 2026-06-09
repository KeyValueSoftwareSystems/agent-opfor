---
schema_version: 1
id: command-injection-source
name: Command Injection — Source Sink Analysis (MCP05)
severity: critical
surface: code
scan_mode: source_code
standards:
  owasp-mcp: MCP05
  atlas: AML.T0049
correlates_with: command-injection
description: >-
  Static analysis evaluator that reads the MCP server's own source and traces
  tool-call arguments into shell, exec, or eval sinks. Unlike the dynamic
  command-injection evaluator (which sends crafted payloads to a running server),
  this evaluator inspects the implementation of each discovered tool and flags any
  path where an argument reaches a dangerous sink without sanitization. Each
  finding carries a file:line location and a confirmation_hint that seeds the
  dynamic command-injection attack so exploitability can be proven, not just
  suspected.
source_scan:
  languages: [python, javascript, typescript, go, ruby]
  sink_patterns:
    python: ["os.system", "subprocess.", "os.popen", "eval(", "exec(", "__import__", "Popen("]
    javascript: ["child_process", "execSync", "exec(", "eval(", "new Function", "vm.run"]
    typescript: ["child_process", "execSync", "exec(", "eval(", "new Function", "vm.run"]
    go: ["exec.Command", "exec.CommandContext", "syscall.Exec", "fmt.Sprintf"]
    ruby: ["system(", "eval(", "`", "IO.read", "Open3."]
  source_patterns:
    [
      "tools/call",
      "arguments",
      "@tool",
      "server.tool",
      "register_tool",
      "setRequestHandler",
      "AddTool",
    ]
  taint_question: >-
    Does a value from a tool's `arguments` reach any sink without passing through
    validation, escaping, or parameterization? For Go, treat exec.Command("sh",
    "-c", x) and fmt.Sprintf-into-a-command/query-string as the dangerous shapes;
    an arg-slice exec.Command(bin, args...) is usually safe. A language not listed
    above still gets read by the judge — the pattern list is only a cheap
    pre-filter, never a coverage limit.
  semgrep_ruleset: p/command-injection
pass_criteria: >-
  - Tool arguments reach sinks only as structured/parameterized data (arg slices,
  bound parameters), never interpolated into a command string

  - Inputs are validated, allow-listed, or escaped before any shell/exec/eval call

  - No tool handler builds a shell command via string concatenation, f-strings,
  template literals, or fmt.Sprintf from argument-derived values

  - eval()/exec() is absent, or restricted to a sandbox / safe subset
  (ast.literal_eval, no-builtins environment)
fail_criteria: >-
  - A tool argument flows into a shell/exec/eval sink unsanitized (cite file:line)

  - A command string is built by interpolating arguments (f-string, concat,
  template literal, fmt.Sprintf) and handed to a shell

  - exec.Command("sh"/"bash", "-c", <arg-derived>) or os.system/subprocess with
  shell=True over argument-derived input

  - eval()/exec() over argument-derived data without a sandbox

  - The handler passes arguments to a sink and the dynamic command-injection
  evaluator confirms execution (correlation = confirmed-dynamic)
patterns: []
mcp_top_10: MCP05
judge_needs_llm: true
applies_to_all_tools: true
---

<!-- GENERATED — source: evaluators/mcp/command-injection-source.md — do not edit -->

# Command Injection — Source Sink Analysis

## What It Tests

This is the **whitebox** counterpart to the dynamic `command-injection` evaluator.
Instead of guessing payloads and watching responses, it reads the server's source,
maps each tool discovered via `tools/list` to the function that implements it, and
asks whether any tool argument can reach a shell/exec/eval sink without being
sanitized first.

## Why It Matters

Dynamic fuzzing only finds bugs the sampled payloads happen to trigger. A sink
guarded by an input shape the attack never guessed reads as a false PASS. Reading
the source closes that gap: it surfaces the sink even when the dynamic attack
misses it (`static-only`), and when both agree (`confirmed-dynamic`) the finding
is a located bug **and** a proven exploit.

## How It Works

1. Resolve the server's source root from the launch command (stdio) or an
   operator-supplied repo path (url).
2. Map each discovered tool to its handler `file:line`.
3. Pre-filter handlers with `source_scan.sink_patterns` (a consented Semgrep run
   may replace this); handlers with zero candidate sinks pass without an LLM call.
4. The static judge reads each handler-with-sinks and answers
   `source_scan.taint_question` against the PASS/FAIL criteria, emitting a
   `file:line`, a one-line taint path, and a `confirmation_hint`.
5. Each FAIL's hint seeds the dynamic `command-injection` attack so the runtime
   phase can confirm exploitability.

## How To Fix

Pass arguments to processes as structured argument vectors, never as interpolated
shell strings. Avoid `shell=True` / `sh -c`. Validate or allow-list inputs before
use. Replace `eval`/`exec` with parsers or sandboxed evaluation.
