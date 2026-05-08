import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

export async function fileExists(p: string): Promise<boolean> {
  try {
    await readFile(p, "utf8");
    return true;
  } catch {
    return false;
  }
}

export async function writeJsonFile(p: string, data: unknown): Promise<void> {
  await mkdir(path.dirname(p), { recursive: true });
  const text = JSON.stringify(data, null, 2) + "\n";
  await writeFile(p, text, "utf8");
}
