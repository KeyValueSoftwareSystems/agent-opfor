import type { McpConnectedClient } from "../mcp-client/createClient.js";
import { log } from "../lib/logger.js";

export interface ResourceInfo {
  uri: string;
  name: string;
  description?: string;
  mimeType?: string;
}

export interface ResourceReadResult {
  uri: string;
  name: string;
  description?: string;
  mimeType?: string;
  content: string;
  readError?: string;
}

export interface ResourceTemplateInfo {
  uriTemplate: string;
  name: string;
  description?: string;
}

export interface ResourceScanResult {
  resources: ResourceReadResult[];
  templates: ResourceTemplateInfo[];
}

/**
 * Enumerate all MCP resources via resources/list, read each one,
 * and return the contents for judging.
 * Gracefully returns empty results if the server doesn't support resources.
 */
export async function scanResources(mcp: McpConnectedClient): Promise<ResourceScanResult> {
  let resources: ResourceInfo[];

  try {
    const listed = await mcp.client.listResources();
    resources = (listed.resources ?? []).map((r) => ({
      uri: r.uri,
      name: r.name,
      ...(r.description ? { description: r.description } : {}),
      ...(r.mimeType ? { mimeType: r.mimeType } : {}),
    }));
  } catch {
    return { resources: [], templates: [] };
  }

  let templates: ResourceTemplateInfo[] = [];
  try {
    const listed = await mcp.client.listResourceTemplates();
    templates = (listed.resourceTemplates ?? []).map((t) => ({
      uriTemplate: t.uriTemplate,
      name: t.name,
      ...(t.description ? { description: t.description } : {}),
    }));
  } catch {
    // Resource templates not supported — fine
  }

  if (templates.length > 0) {
    log.info(
      `resources/listTemplates: ${templates.length} template(s) (skipped — require arguments)`
    );
  }

  const results: ResourceReadResult[] = [];

  for (const resource of resources) {
    try {
      const read = await mcp.client.readResource({ uri: resource.uri });
      const textParts = (read.contents ?? [])
        .filter(
          (c): c is { uri: string; text: string } => "text" in c && typeof c.text === "string"
        )
        .map((c) => c.text);
      const content = textParts.join("\n").trim();
      results.push({ ...resource, content });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      results.push({ ...resource, content: "", readError: msg.slice(0, 300) });
    }
  }

  return { resources: results, templates };
}

/** Slim projection for embedding in attack plans and generator prompts. */
export function resourcesDigest(resources: ResourceInfo[]): ResourceInfo[] {
  return resources.map((r) => ({
    uri: r.uri,
    name: r.name,
    ...(r.description ? { description: r.description } : {}),
    ...(r.mimeType ? { mimeType: r.mimeType } : {}),
  }));
}
