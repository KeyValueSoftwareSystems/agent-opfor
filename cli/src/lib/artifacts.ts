import path from "node:path";
import { mkdir } from "node:fs/promises";
import { randomUUID } from "node:crypto";

export const ASTRA_DIR = ".astra";
export const ASTRA_CONFIGS_DIR = path.join(ASTRA_DIR, "configs");
export const ASTRA_ATTACKS_DIR = path.join(ASTRA_DIR, "attacks");
export const ASTRA_REPORTS_DIR = path.join(ASTRA_DIR, "reports");

export async function ensureAstraDirs(): Promise<void> {
  await mkdir(ASTRA_CONFIGS_DIR, { recursive: true });
  await mkdir(ASTRA_ATTACKS_DIR, { recursive: true });
  await mkdir(ASTRA_REPORTS_DIR, { recursive: true });
}

export function compactTimestamp(d = new Date()): string {
  return d
    .toISOString()
    .replace(/[-:T.Z]/g, "")
    .slice(0, 14);
}

export function newId(): string {
  return randomUUID().slice(0, 8);
}

export function newConfigPath(now = new Date()): string {
  const ts = compactTimestamp(now);
  const id = newId();
  return path.join(ASTRA_CONFIGS_DIR, `astra-config-${ts}-${id}.json`);
}

export function newAttacksPath(configId: string, now = new Date()): string {
  const ts = compactTimestamp(now);
  return path.join(ASTRA_ATTACKS_DIR, `astra-attacks-${ts}-${configId}.json`);
}
