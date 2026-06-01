#!/usr/bin/env node
/**
 * Bundles evaluator + suite metadata from repo-root `evaluators/agent` + `suites/agent`
 * into `extension/catalog.json` for the MV3 extension (no filesystem access at
 * runtime).
 *
 * Run from repo root: node extension/scripts/build-catalog.mjs
 */
import { readFile, readdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parse as parseYaml } from "yaml";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "../../..");
const EVALUATORS_DIR = path.join(REPO_ROOT, "evaluators/agent");
const SUITES_DIR = path.join(REPO_ROOT, "suites/agent");
const OUT = path.join(REPO_ROOT, "runners/extension/catalog.json");

function splitYamlFrontmatter(raw) {
  const lines = raw.split(/\r?\n/);
  if (lines.length < 2 || lines[0].trim() !== "---") return null;
  for (let i = 1; i < lines.length; i++) {
    if (lines[i].trim() === "---") {
      return {
        yaml: lines.slice(1, i).join("\n"),
        body: lines.slice(i + 1).join("\n"),
      };
    }
  }
  return null;
}

function str(doc, key) {
  const v = doc[key];
  return typeof v === "string" ? v : "";
}

function inferKey(id) {
  const code = id.trim().toUpperCase();
  if (/^LLM\d+/.test(code)) return "owasp-llm";
  if (/^MCP\d+/.test(code)) return "owasp-mcp";
  if (/^ASI\d+/.test(code)) return "owasp-agentic";
  if (/^API\d+/.test(code)) return "owasp-api";
  if (/^AML\.T\d+/.test(code)) return "atlas";
  return "standard";
}

function parseStandards(doc) {
  const raw = doc.standards;
  if (raw && typeof raw === "object" && !Array.isArray(raw)) {
    const out = {};
    for (const [k, v] of Object.entries(raw)) {
      if (typeof k === "string" && k.trim() && typeof v === "string" && v.trim()) {
        out[k.trim()] = v.trim();
      }
    }
    if (Object.keys(out).length > 0) return out;
  }
  const legacy = str(doc, "ref");
  if (!legacy.trim() || legacy === "—") return { "trust-safety": "general" };
  const out = {};
  for (const part of legacy
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean)) {
    out[inferKey(part)] = part;
  }
  return out;
}

function parsePatterns(doc) {
  const raw = doc.patterns;
  if (!Array.isArray(raw)) return [];
  const out = [];
  for (const item of raw) {
    if (!item || typeof item !== "object") continue;
    const o = item;
    const name = str(o, "name");
    const template = str(o, "template");
    if (!name.trim() || !template.trim()) continue;
    out.push({ name: name.trim(), template: template.trim() });
  }
  return out;
}

async function parseEvaluatorMd(filePath, fname) {
  const raw = await readFile(filePath, "utf8");
  const sp = splitYamlFrontmatter(raw);
  if (!sp) throw new Error(`${fname}: missing YAML frontmatter`);
  let doc;
  try {
    doc = parseYaml(sp.yaml);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    throw new Error(`${fname}: invalid YAML: ${msg}`, { cause: e });
  }
  if (!doc || typeof doc !== "object") throw new Error(`${fname}: invalid frontmatter`);

  const id = str(doc, "id") || fname.replace(/\.md$/i, "");
  const name = str(doc, "name");
  const patterns = parsePatterns(doc);
  if (!name.trim()) throw new Error(`${fname}: frontmatter must set name`);
  if (!patterns.length) throw new Error(`${fname}: frontmatter must set patterns (non-empty)`);

  return {
    id: id.trim(),
    name: name.trim(),
    severity: str(doc, "severity") || "high",
    standards: parseStandards(doc),
    description: str(doc, "description"),
    passCriteria: str(doc, "pass_criteria") || str(doc, "passCriteria"),
    failCriteria: str(doc, "fail_criteria") || str(doc, "failCriteria"),
    patterns,
  };
}

async function parseSuiteMd(filePath, fname) {
  const raw = await readFile(filePath, "utf8");
  const sp = splitYamlFrontmatter(raw);
  if (!sp) throw new Error(`${fname}: missing YAML frontmatter`);
  const doc = parseYaml(sp.yaml);
  if (!doc || typeof doc !== "object") throw new Error(`${fname}: invalid frontmatter`);
  const id = str(doc, "id");
  if (!id.trim()) throw new Error(`${fname}: frontmatter must set id`);
  const ev = doc.evaluators;
  if (!Array.isArray(ev) || ev.some((x) => typeof x !== "string")) {
    throw new Error(`${fname}: frontmatter must set evaluators: [string, ...]`);
  }
  return {
    id: id.trim(),
    name: typeof doc.name === "string" ? doc.name.trim() : id.trim(),
    description: typeof doc.description === "string" ? doc.description.trim() : "",
    evaluatorIds: ev.map((x) => String(x).trim()).filter(Boolean),
  };
}

async function main() {
  const evalDir = EVALUATORS_DIR;
  const suitesDir = SUITES_DIR;

  const evalFiles = (await readdir(evalDir)).filter((f) => f.endsWith(".md"));
  const evaluators = [];
  for (const f of evalFiles.sort()) {
    try {
      evaluators.push(await parseEvaluatorMd(path.join(evalDir, f), f));
    } catch (e) {
      console.warn(`[build-catalog] skip ${f}: ${e instanceof Error ? e.message : e}`);
    }
  }
  evaluators.sort((a, b) => a.id.localeCompare(b.id));

  const suiteFiles = (await readdir(suitesDir)).filter((f) => f.endsWith(".md"));
  const suites = [];
  for (const f of suiteFiles.sort()) {
    suites.push(await parseSuiteMd(path.join(suitesDir, f), f));
  }

  const byId = new Map(evaluators.map((e) => [e.id, e]));
  for (const s of suites) {
    const missing = s.evaluatorIds.filter((id) => !byId.has(id));
    if (missing.length) {
      console.warn(
        `[build-catalog] suite ${s.id} references unknown evaluator ids: ${missing.join(", ")}`
      );
    }
  }

  const payload = {
    version: 1,
    generatedAt: new Date().toISOString(),
    source: "evaluators/agent",
    suites,
    evaluators,
  };

  await writeFile(OUT, JSON.stringify(payload, null, 2) + "\n", "utf8");
  console.log(`Wrote ${OUT} (${suites.length} suites, ${evaluators.length} evaluators)`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
