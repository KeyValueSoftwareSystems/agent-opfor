/**
 * Generate MITRE ATLAS coverage report(s) from evaluator `standards.atlas` tags.
 *
 * Outputs:
 * - docs/coverage/mitre-atlas.md
 * - docs/coverage/mitre-atlas.json
 */

import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { loadAtlasTechniqueIndex } from "../core/src/standards/atlas.js";
import { loadSkillCatalog } from "../core/src/config/loadSkillCatalog.js";
import { loadCatalog as loadMcpCatalog } from "../core/src/catalog/loadCatalog.js";

type TreeId = "agent-redteaming" | "mcp-redteaming";

interface SuiteCoverage {
  tree: TreeId;
  suiteId: string;
  suiteName: string;
  suiteDescription: string;
  totalAtlasTechniques: number;
  coveredCount: number;
  covered: Record<
    string,
    {
      techniqueName: string;
      evaluatorIds: string[];
      evaluatorNames: string[];
    }
  >;
  uncovered: Array<{ id: string; name: string }>;
}

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "..");
const OUT_DIR = path.join(REPO_ROOT, "docs", "coverage");
const OUT_MD = path.join(OUT_DIR, "mitre-atlas.md");
const OUT_JSON = path.join(OUT_DIR, "mitre-atlas.json");

function escMd(s: string): string {
  return String(s ?? "")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function toAtlasTopLevelId(id: string): string | null {
  const v = id.trim();
  return /^AML\.T\d{4}$/.test(v) ? v : null;
}

async function main(): Promise<void> {
  const atlasIndex = await loadAtlasTechniqueIndex();
  const atlasTopLevel = [...atlasIndex.keys()]
    .map(toAtlasTopLevelId)
    .filter((x): x is string => Boolean(x));
  atlasTopLevel.sort((a, b) => a.localeCompare(b));

  const agent = await loadSkillCatalog();
  const mcp = await loadMcpCatalog();

  const trees: Array<{
    tree: TreeId;
    evaluators: Array<{ id: string; name: string; standards?: Record<string, string> }>;
    suites: Array<{ id: string; name: string; description: string; evaluatorIds: string[] }>;
  }> = [
    {
      tree: "agent-redteaming",
      evaluators: agent.evaluators,
      suites: agent.suites.map((s) => ({
        id: s.id,
        name: s.name,
        description: s.description,
        evaluatorIds: s.evaluatorIds,
      })),
    },
    {
      tree: "mcp-redteaming",
      evaluators: mcp.evaluators,
      suites: mcp.suites.map((s) => ({
        id: s.id,
        name: s.name,
        description: s.description,
        evaluatorIds: s.evaluatorIds,
      })),
    },
  ];

  const suiteReports: SuiteCoverage[] = [];

  for (const t of trees) {
    const byId = new Map(t.evaluators.map((e) => [e.id, e]));

    for (const suite of t.suites) {
      const covered: SuiteCoverage["covered"] = {};

      for (const evId of suite.evaluatorIds) {
        const ev = byId.get(evId);
        if (!ev) continue;
        const atlas = typeof ev.standards?.atlas === "string" ? ev.standards.atlas.trim() : "";
        const topLevel = atlas ? toAtlasTopLevelId(atlas) : null;
        if (!topLevel) continue;
        const techniqueName = atlasIndex.get(topLevel)?.name ?? topLevel;

        const cur = covered[topLevel] ?? {
          techniqueName,
          evaluatorIds: [],
          evaluatorNames: [],
        };
        cur.evaluatorIds.push(ev.id);
        cur.evaluatorNames.push(ev.name);
        covered[topLevel] = cur;
      }

      const coveredIds = new Set(Object.keys(covered));
      const uncovered = atlasTopLevel
        .filter((id) => !coveredIds.has(id))
        .map((id) => ({ id, name: atlasIndex.get(id)?.name ?? id }));

      suiteReports.push({
        tree: t.tree,
        suiteId: suite.id,
        suiteName: suite.name,
        suiteDescription: suite.description,
        totalAtlasTechniques: atlasTopLevel.length,
        coveredCount: coveredIds.size,
        covered,
        uncovered,
      });
    }
  }

  suiteReports.sort((a, b) => (a.tree + ":" + a.suiteId).localeCompare(b.tree + ":" + b.suiteId));

  const now = new Date().toISOString();
  const md = [
    "# MITRE ATLAS coverage\n",
    "",
    `Generated: ${now}`,
    "",
    "This report is derived from evaluator frontmatter `standards.atlas` tags.",
    "ATLAS source of truth: `third_party/atlas-data/` (git submodule).",
    "",
    ...suiteReports.flatMap((s) => {
      const header = `## ${escMd(s.suiteName)} (\`${s.suiteId}\`) — ${s.tree}`;
      const desc = s.suiteDescription?.trim() ? escMd(s.suiteDescription.trim()) : "";
      const summary = `Covered **${s.coveredCount}/${s.totalAtlasTechniques}** top-level ATLAS techniques.`;

      const coveredIds = Object.keys(s.covered).sort((a, b) => a.localeCompare(b));
      const coveredLines =
        coveredIds.length === 0
          ? ["- (none tagged)"]
          : coveredIds.map((id) => {
              const c = s.covered[id]!;
              const n = c.evaluatorIds.length;
              return `- \`${id}\`  ${escMd(c.techniqueName)}  — ✓ covered (${n} evaluator${n === 1 ? "" : "s"})`;
            });

      const uncoveredLines =
        s.uncovered.length === 0
          ? ["- (none)"]
          : s.uncovered.map((u) => `- \`${u.id}\`  ${escMd(u.name)}  — ✗ not covered`);

      return [
        header,
        ...(desc ? ["", desc] : []),
        "",
        summary,
        "",
        "### Covered",
        ...coveredLines,
        "",
        "### Not covered (top-level techniques)",
        ...uncoveredLines,
        "",
      ];
    }),
  ].join("\n");

  await mkdir(OUT_DIR, { recursive: true });
  await writeFile(OUT_MD, md, "utf8");
  await writeFile(
    OUT_JSON,
    JSON.stringify({ generatedAt: now, suites: suiteReports }, null, 2),
    "utf8"
  );

  console.log(`Wrote ${path.relative(REPO_ROOT, OUT_MD)}`);
  console.log(`Wrote ${path.relative(REPO_ROOT, OUT_JSON)}`);
}

main().catch((e) => {
  console.error("generate-atlas-coverage crashed:", e);
  process.exit(1);
});
