import { readFile } from "node:fs/promises";
import { AstraMcpConfigSchema, type AstraMcpConfig } from "../config/schema.js";

export async function loadAstraMcpConfigFile(configPath: string): Promise<AstraMcpConfig> {
  const raw = await readFile(configPath, "utf8");
  const json: unknown = JSON.parse(raw);
  const parsed = AstraMcpConfigSchema.safeParse(json);
  if (!parsed.success) {
    const msg = parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ");
    throw new Error(`Invalid astra-mcp config: ${msg}`);
  }
  return parsed.data;
}
