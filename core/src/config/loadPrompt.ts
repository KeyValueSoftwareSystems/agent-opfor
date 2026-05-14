import { readFileSync } from "node:fs";
import { realpathSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(realpathSync(fileURLToPath(import.meta.url)));

const cache = new Map<string, string>();

/**
 * Load a prompt from core/src/prompts/<id>.md.
 * Strips YAML frontmatter and returns the body text.
 * Results are cached after first load.
 */
export function loadPrompt(id: string): string {
  if (cache.has(id)) return cache.get(id)!;

  // Resolves from core/dist/config/ → ../../src/prompts/
  const filePath = path.resolve(__dirname, "../../src/prompts", `${id}.md`);
  const raw = readFileSync(filePath, "utf-8");

  // Strip YAML frontmatter block (--- ... ---)
  const body = raw.replace(/^---\n[\s\S]*?\n---\n/, "").trim();

  cache.set(id, body);
  return body;
}
