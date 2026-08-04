/**
 * Generate the vendored model price table.
 *
 * Downloads LiteLLM's community price map, prunes it to the providers opfor can
 * actually reach, and writes core/src/pricing/priceTable.generated.ts.
 *
 * Why vendored rather than fetched at runtime: opfor runs in air-gapped CI and
 * locked-down corporate networks, and a security report should produce the same
 * numbers when re-run months later. Pruned, the table is ~60 KB — small enough
 * to inline, which also lets the browser extension use it (esbuild bundles the
 * generated module; nothing here touches node:fs at runtime).
 *
 * Usage:
 *   npm run build:pricing            # refresh the table
 *   npm run build:pricing -- --check # exit 1 if the table differs from upstream
 *
 * NOTE: --check is intentionally NOT a blocking CI gate. Unlike the evaluator
 * catalog (which goes stale only when this repo changes), this table goes stale
 * when a third party reprices a model — gating merges on that would let outside
 * events break the build. Run it on a schedule and open a PR instead.
 */

import { createHash } from "node:crypto";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { format, resolveConfig } from "prettier";
import { z } from "zod";
import { VENDORED_LITELLM_PROVIDERS } from "../core/src/pricing/providerAliases.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "..");
const OUT_FILE = path.join(REPO_ROOT, "core/src/pricing/priceTable.generated.ts");
const CHECK_ONLY = process.argv.includes("--check");

const SOURCE_URL =
  "https://raw.githubusercontent.com/BerriAI/litellm/main/model_prices_and_context_window.json";

/**
 * Upstream entry shape — only the fields we consume; everything else is ignored.
 *
 * The map is third-party data fetched over the network, so it is validated
 * rather than cast (AGENTS.md: Zod for all external input). Rows are parsed
 * individually and a row that fails is skipped and counted, so one malformed
 * entry upstream cannot fail the whole build — but a wholesale format change
 * shows up as a collapsed row count and trips the empty-table guard below.
 */
const UpstreamEntrySchema = z.object({
  litellm_provider: z.string().min(1).optional(),
  mode: z.string().optional(),
  input_cost_per_token: z.number().nonnegative().optional(),
  output_cost_per_token: z.number().nonnegative().optional(),
  cache_read_input_token_cost: z.number().nonnegative().optional(),
  cache_creation_input_token_cost: z.number().nonnegative().optional(),
});

/** The document itself must be an object of named entries. */
const UpstreamMapSchema = z.record(z.string(), z.unknown());

/** Compact on-disk shape. Short keys because this file is generated, not read. */
interface CompactPrice {
  /** litellm_provider */
  p: string;
  /** input cost per token */
  i: number;
  /** output cost per token */
  o: number;
  /** cache-read cost per token */
  cr?: number;
  /** cache-write cost per token */
  cw?: number;
}

/** Only chat-shaped models can be an attacker or a judge; skip image/audio/embedding rows. */
const CHAT_MODES = new Set(["chat", "responses"]);

function prune(raw: Record<string, unknown>): {
  table: Record<string, CompactPrice>;
  droppedProviders: Map<string, number>;
  malformed: string[];
} {
  const keep = new Set(VENDORED_LITELLM_PROVIDERS);
  const table: Record<string, CompactPrice> = {};
  const droppedProviders = new Map<string, number>();
  const malformed: string[] = [];

  for (const [key, value] of Object.entries(raw)) {
    if (!value || typeof value !== "object") continue;
    const parsed = UpstreamEntrySchema.safeParse(value);
    if (!parsed.success) {
      malformed.push(key);
      continue;
    }
    const e = parsed.data;
    const provider = e.litellm_provider;
    if (!provider) continue;

    if (!keep.has(provider)) {
      droppedProviders.set(provider, (droppedProviders.get(provider) ?? 0) + 1);
      continue;
    }
    if (!e.mode || !CHAT_MODES.has(e.mode)) continue;
    // A row without an input price cannot produce a cost; drop it rather than
    // let it match and silently price at zero.
    if (typeof e.input_cost_per_token !== "number") continue;

    const entry: CompactPrice = {
      p: provider,
      i: e.input_cost_per_token,
      o: typeof e.output_cost_per_token === "number" ? e.output_cost_per_token : 0,
    };
    if (typeof e.cache_read_input_token_cost === "number") {
      entry.cr = e.cache_read_input_token_cost;
    }
    if (typeof e.cache_creation_input_token_cost === "number") {
      entry.cw = e.cache_creation_input_token_cost;
    }
    table[key] = entry;
  }

  return { table, droppedProviders, malformed };
}

/** Stable stringify: sorted keys so an unchanged upstream yields an identical file. */
function serializeTable(table: Record<string, CompactPrice>): string {
  const keys = Object.keys(table).sort();
  const lines = keys.map((k) => `  ${JSON.stringify(k)}: ${JSON.stringify(table[k])},`);
  return lines.join("\n");
}

function renderModule(body: string, version: string, entryCount: number): string {
  return `/**
 * GENERATED FILE — do not edit by hand.
 *
 * Model prices in USD per token, pruned from LiteLLM's community price map:
 *   ${SOURCE_URL}
 *
 * Regenerate with: npm run build:pricing
 *
 * Entries: ${entryCount}
 *
 * Contains no Node imports so the browser extension can bundle it.
 */

/** Compact price row. Short keys keep the generated table small. */
export interface CompactPrice {
  /** Upstream \`litellm_provider\` — used to reject a match from the wrong vendor. */
  p: string;
  /** USD per input token. */
  i: number;
  /** USD per output token. */
  o: number;
  /** USD per cached input token, when published. */
  cr?: number;
  /** USD per cache-write token, when published. */
  cw?: number;
}

/** Identifies this snapshot; recorded in reports so a cost figure is reproducible. */
export const PRICE_TABLE_VERSION = ${JSON.stringify(version)};

export const PRICE_TABLE: Record<string, CompactPrice> = {
${body}
};
`;
}

async function main(): Promise<void> {
  process.stdout.write(`[build-pricing] fetching ${SOURCE_URL}\n`);
  const res = await fetch(SOURCE_URL);
  if (!res.ok) {
    throw new Error(
      `Failed to download the price map: HTTP ${res.status}. ` +
        `Check network access, or retry later — the vendored table is still usable meanwhile.`
    );
  }
  const rawText = await res.text();
  const parsedDoc = UpstreamMapSchema.safeParse(JSON.parse(rawText));
  if (!parsedDoc.success) {
    throw new Error(
      `The downloaded price map is not an object of named entries — upstream may have ` +
        `changed format. Refusing to regenerate from it. (${parsedDoc.error.issues[0]?.message})`
    );
  }
  const raw = parsedDoc.data;

  const { table, droppedProviders, malformed } = prune(raw);
  const entryCount = Object.keys(table).length;
  if (entryCount === 0) {
    throw new Error(
      "Pruning produced an empty table — upstream may have changed shape. " +
        "Refusing to overwrite the vendored table with nothing."
    );
  }

  const body = serializeTable(table);
  // Version off the pruned content, not the fetch time: regenerating against an
  // unchanged upstream must be a no-op diff.
  const version = `litellm-${createHash("sha256").update(body).digest("hex").slice(0, 12)}`;
  // Run the rendered module through the repo's Prettier config before comparing
  // or writing. Without this the committed file (reformatted by the pre-commit
  // hook) never equals this script's raw output, which would make `--check`
  // report "stale" forever and turn every regeneration into a full-file diff.
  const contents = await format(renderModule(body, version, entryCount), {
    ...(await resolveConfig(OUT_FILE)),
    parser: "typescript",
  });

  const existing = await readFile(OUT_FILE, "utf8").catch(() => null);

  process.stdout.write(
    `[build-pricing] upstream ${Object.keys(raw).length} entries -> kept ${entryCount} ` +
      `across ${VENDORED_LITELLM_PROVIDERS.length} providers (${(body.length / 1024).toFixed(1)} KB)\n`
  );
  // Say what was left out — a silent prune reads as full coverage when it isn't.
  const topDropped = [...droppedProviders.entries()].sort((a, b) => b[1] - a[1]).slice(0, 5);
  process.stdout.write(
    `[build-pricing] dropped providers (top 5): ${topDropped.map(([p, n]) => `${p}=${n}`).join(", ")}\n`
  );
  // Surface schema rejections rather than folding them into the drop count —
  // a sudden spike means upstream changed a field's type on us.
  if (malformed.length > 0) {
    process.stdout.write(
      `[build-pricing] ${malformed.length} row(s) failed validation and were skipped: ` +
        `${malformed.slice(0, 5).join(", ")}${malformed.length > 5 ? ", …" : ""}\n`
    );
  }

  if (CHECK_ONLY) {
    if (existing !== contents) {
      process.stderr.write(
        `[build-pricing] STALE — ${OUT_FILE} differs from upstream. Run: npm run build:pricing\n`
      );
      process.exit(1);
    }
    process.stdout.write(`[build-pricing] up to date (${version})\n`);
    return;
  }

  if (existing === contents) {
    process.stdout.write(`[build-pricing] unchanged (${version})\n`);
    return;
  }

  await mkdir(path.dirname(OUT_FILE), { recursive: true });
  await writeFile(OUT_FILE, contents, "utf8");
  process.stdout.write(`[build-pricing] wrote ${OUT_FILE} (${version})\n`);
}

main().catch((err: unknown) => {
  process.stderr.write(`[build-pricing] ${err instanceof Error ? err.message : String(err)}\n`);
  process.exit(1);
});
