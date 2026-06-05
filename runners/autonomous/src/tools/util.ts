// Shared helpers for tool handlers.

import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";

/** Wrap a JSON-serializable payload as a text tool result. */
export function jsonResult(payload: unknown): CallToolResult {
  return { content: [{ type: "text", text: JSON.stringify(payload) }] };
}

/** Wrap a plain string as a text tool result. */
export function textResult(text: string, isError = false): CallToolResult {
  return { content: [{ type: "text", text }], isError };
}
