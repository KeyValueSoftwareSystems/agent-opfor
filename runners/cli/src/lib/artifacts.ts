import path from "node:path";
import { mkdir } from "node:fs/promises";
import { randomUUID } from "node:crypto";

export const OPFOR_DIR = ".opfor";
export const OPFOR_CONFIGS_DIR = path.join(OPFOR_DIR, "configs");
export const OPFOR_REPORTS_DIR = path.join(OPFOR_DIR, "reports");

export async function ensureOpforDirs(): Promise<void> {
  await mkdir(OPFOR_CONFIGS_DIR, { recursive: true });
  await mkdir(OPFOR_REPORTS_DIR, { recursive: true });
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
  return path.join(OPFOR_CONFIGS_DIR, `opfor-config-${ts}-${id}.json`);
}
