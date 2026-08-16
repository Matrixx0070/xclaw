#!/usr/bin/env node
/**
 * Wave A: convert WildClawBench task markdown → XClaw eval cases.
 */
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { adaptWildClawPrompt } from "../src/tools/aliases/openclaw-map.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(__dirname, "..");
const WC =
  process.env.WILDCLAW_ROOT ||
  path.resolve("/tmp/WildClawBench");
const OUT = path.join(REPO, "eval/cases/wildclaw-wave-a.json");

function parseFrontMatter(raw) {
  if (!raw.startsWith("---")) return { meta: {}, body: raw };
  const end = raw.indexOf("---", 3);
  if (end < 0) return { meta: {}, body: raw };
  const fm = raw.slice(3, end).trim();
  const body = raw.slice(end + 3).trim();
  const meta = {};
  for (const line of fm.split("\n")) {
    const m = line.match(/^(\w+):\s*(.*)$/);
    if (m) meta[m[1]] = m[2].trim();
  }
  return { meta, body };
}

function extractPrompt(body) {
  const m = body.match(/##\s*Prompt\s*\n([\s\S]*?)(?=\n##\s|\n###\s*Output|\n##\s*Expected|\n##\s*Grading|$)/i);
  if (m) return m[1].trim();
  return body.slice(0, 4000);
}

/** Wave A: pure-text or categories we can attempt without video/email services */
function isWaveA(meta, filePath) {
  const mod = (meta.modality || "").toLowerCase();
  if (mod.includes("video") || mod.includes("image") && mod.includes("multi")) {
    // still allow some image-light later
  }
  const cat = meta.category || filePath;
  if (cat.includes("05_Creative") && /video|poster|crop|dub|outfit/i.test(filePath)) {
    return false;
  }
  if (cat.includes("03_Social")) {
    // social needs chat/email sims — exclude from wave A strict
    return false;
  }
  // include productivity, search, safety, code (text)
  if (
    cat.includes("01_Productivity") ||
    cat.includes("04_Search") ||
    cat.includes("06_Safety") ||
    cat.includes("02_Code")
  ) {
    if (/jigsaw|connect_the_dots|puzzle|img|video/i.test(filePath)) return false;
    return true;
  }
  if (mod === "pure-text") return true;
  return false;
}

function softExpect(prompt) {
  // Prefer results/ outputs when mentioned
  if (/results\//i.test(prompt) || /\/tmp_workspace\/results/i.test(prompt)) {
    return {
      success: [{ type: "file_exists", path: "results" }],
      note: "soft: results/ directory or file existence",
    };
  }
  return {
    success: [],
    replyNonEmpty: true,
    note: "soft: no file path — pass if agent finishes without throw (scored by tools+handoff)",
  };
}

async function walk(dir, acc = []) {
  let entries;
  try {
    entries = await fs.readdir(dir, { withFileTypes: true });
  } catch {
    return acc;
  }
  for (const ent of entries) {
    const p = path.join(dir, ent.name);
    if (ent.isDirectory()) await walk(p, acc);
    else if (/task_.*\.md$/i.test(ent.name) || /_task_\d+/i.test(ent.name)) {
      acc.push(p);
    }
  }
  return acc;
}

const files = await walk(path.join(WC, "tasks"));
const cases = [];
const skipped = [];

for (const file of files) {
  const raw = await fs.readFile(file, "utf8");
  const { meta, body } = parseFrontMatter(raw);
  if (!isWaveA(meta, file)) {
    skipped.push({ file: path.relative(WC, file), reason: "not_wave_a" });
    continue;
  }
  const promptRaw = extractPrompt(body);
  const prompt = adaptWildClawPrompt(promptRaw);
  const id = `wc-a-${meta.id || path.basename(file, ".md")}`;
  const expect = softExpect(promptRaw);
  const timeoutSec = Number(meta.timeout_seconds) || 600;
  cases.push({
    id,
    tags: [
      "wildclaw",
      "wave-a",
      "autonomy",
      (meta.category || "unknown").split("_").slice(0, 2).join("_"),
    ],
    name: meta.name || id,
    source: path.relative(WC, file),
    modality: meta.modality || null,
    prompt,
    maxTurns: 20,
    timeoutMs: Math.min(900_000, Math.max(120_000, timeoutSec * 1000)),
    expect: {
      success: expect.success,
      soft: true,
      replyNonEmpty: expect.replyNonEmpty || false,
    },
  });
}

await fs.mkdir(path.dirname(OUT), { recursive: true });
await fs.writeFile(OUT, JSON.stringify(cases, null, 2));
await fs.writeFile(
  path.join(REPO, "reports/autonomy/wave-a-convert.json"),
  JSON.stringify(
    { converted: cases.length, skipped: skipped.length, out: OUT, cases: cases.map((c) => c.id) },
    null,
    2
  )
);
console.log(JSON.stringify({ converted: cases.length, skipped: skipped.length, out: OUT }, null, 2));
