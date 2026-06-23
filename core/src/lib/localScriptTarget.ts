import { spawn } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";

const TIMEOUT_MS = 30_000;

/** Reads the shebang line of a file, returns the interpreter path or null. */
function readShebang(absPath: string): string | null {
  try {
    const head = readFileSync(absPath, { encoding: "utf8" }).slice(0, 256);
    const firstLine = head.split("\n")[0];
    if (firstLine.startsWith("#!")) return firstLine.slice(2).trim();
  } catch {
    /* ignore */
  }
  return null;
}

/** Picks interpreter from shebang first, then falls back to file extension. */
function interpreterCommandForPath(absPath: string): string | null {
  const shebang = readShebang(absPath);
  if (shebang) return shebang;
  const ext = path.extname(absPath).toLowerCase();
  if (ext === ".py" || ext === ".pyw") return "python3";
  if (ext === ".js" || ext === ".mjs" || ext === ".cjs") return "node";
  return null;
}

/**
 * Run a local target script (.js / .mjs / .cjs or .py): write one JSON object to stdin
 * `{ prompt, context?, sessionId? }`, read stdout JSON with a string "response" (or "error").
 *
 * For multi-turn attacks pass `sessionId` so the script can maintain its own conversation
 * history keyed by session.
 */
export async function invokeLocalTargetScript(
  scriptPath: string,
  input: { prompt: string; context?: Record<string, unknown>; sessionId?: string }
): Promise<string> {
  const abs = path.resolve(scriptPath);
  const command = interpreterCommandForPath(abs);
  if (!command) {
    const ext = path.extname(abs).toLowerCase() || "(no extension)";
    return `ERROR: unsupported script type (${ext}). Use a .js, .mjs, .cjs, or .py file.`;
  }
  const args = [abs];

  const child = spawn(command, args, {
    stdio: ["pipe", "pipe", "pipe"],
  });

  const stdinPayload: Record<string, unknown> = {
    prompt: input.prompt,
    context: input.context ?? {},
  };
  if (input.sessionId) stdinPayload.sessionId = input.sessionId;
  const stdinJson = JSON.stringify(stdinPayload);

  let stdout = "";
  let stderr = "";
  child.stdout?.setEncoding("utf8");
  child.stderr?.setEncoding("utf8");
  child.stdout?.on("data", (c: string) => {
    stdout += c;
  });
  child.stderr?.on("data", (c: string) => {
    stderr += c;
    // So you can `console.error(...)` in the target script and see it during `opfor run`.
    process.stderr.write(c);
  });

  return await new Promise((resolve) => {
    let settled = false;
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      try {
        child.kill("SIGTERM");
      } catch {
        /* ignore */
      }
      resolve("ERROR: script timed out");
    }, TIMEOUT_MS);

    const finish = (value: string) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(value);
    };

    child.on("close", (code) => {
      const trimmed = stdout.trim();
      if (!trimmed) {
        finish(
          `ERROR: no stdout from script (exit ${code ?? "?"})${stderr ? ` — ${stderr.trim()}` : ""}`
        );
        return;
      }
      try {
        const j = JSON.parse(trimmed) as { response?: unknown; error?: unknown };
        if (j.error != null) finish(String(j.error));
        else if (j.response != null) finish(String(j.response));
        else finish(trimmed);
      } catch {
        finish(`ERROR: stdout is not valid JSON — ${trimmed.slice(0, 200)}`);
      }
    });

    child.on("error", (err) => {
      finish(`ERROR: failed to start ${command}: ${err.message}`);
    });

    child.stdin.write(stdinJson, "utf8");
    child.stdin.end();
  });
}
