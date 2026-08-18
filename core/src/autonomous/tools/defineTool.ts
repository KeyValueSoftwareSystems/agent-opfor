// Runtime-agnostic tool definition for the autonomous red-team toolset.
//
// This deliberately mirrors the signature of the Claude Agent SDK's `tool()` helper
// that it replaces — that helper was only ever a plain object constructor, so keeping
// the shape means every tool module is unchanged apart from its import.
//
// Tools defined here carry NO dependency on any agent runtime. The runner
// (orchestrator/agentLoop.ts) adapts them to whatever loop is driving them, which is
// what lets the same toolset run under the Node CLI and, later, a browser bundle.

import type { z, ZodRawShape } from "zod";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";

/** The argument object a handler receives, inferred from its Zod shape. */
export type InferShape<Shape extends ZodRawShape> = z.infer<z.ZodObject<Shape>>;

export interface RedteamTool<Shape extends ZodRawShape = ZodRawShape> {
  name: string;
  description: string;
  /** Raw Zod shape (not a ZodObject) — the runner wraps it when building its schema. */
  inputSchema: Shape;
  handler: (args: InferShape<Shape>, extra?: unknown) => Promise<CallToolResult>;
}

/**
 * A tool whose argument type has been erased so heterogeneous tools can share a list.
 *
 * `any` is load-bearing here: handler args are contravariant, so `RedteamTool<{a: ZodString}>`
 * is not assignable to `RedteamTool<ZodRawShape>`, and TypeScript has no existential type to
 * express "some shape". The erasure is confined to this alias — each tool's own handler stays
 * fully typed through the generic `defineTool()` below, and the runner re-validates every
 * argument object against the tool's real schema before calling it.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type AnyRedteamTool = RedteamTool<any>;

/**
 * Define one red-team tool. Positional signature matches the SDK helper it replaces:
 * `defineTool(name, description, zodShape, handler)`.
 */
export function defineTool<Shape extends ZodRawShape>(
  name: string,
  description: string,
  inputSchema: Shape,
  handler: (args: InferShape<Shape>, extra?: unknown) => Promise<CallToolResult>
): RedteamTool<Shape> {
  return { name, description, inputSchema, handler };
}

/** Back-compat alias so tool modules read exactly as they did under the SDK. */
export { defineTool as tool };
