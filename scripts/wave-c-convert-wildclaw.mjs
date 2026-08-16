#!/usr/bin/env node
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { adaptWildClawPrompt } from "../src/tools/aliases/openclaw-map.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(__dirname, "..");
const WC = process.env.WILDCLAW_ROOT || "/tmp/WildClawBench";
const OUT = path.join(REPO, "eval/cases/wildclaw-wave-c.json");

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
  const m = body.match(
    /##\s*Prompt\s*\n([\s\S]*?)(?=\n##\s*Expected|\n##\s*Grading|\n##\s*Automated|$)/i
  );
  return m ? m[1].trim() : body.slice(0, 5000);
}

function isWaveC(meta, filePath) {
  if (filePath.includes("03_Social")) return true;
  if (filePath.includes("05_Creative")) {
    // skip pure video-heavy
    if (/video_en_to_zh|goal_highlights|video_notes|product_launch_video|clothing_outfit/i.test(filePath))
      return false;
    return true;
  }
  return false;
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
    else if (/task_.*\.md$/i.test(ent.name)) acc.push(p);
  }
  return acc;
}

const files = await walk(path.join(WC, "tasks"));
const cases = [];
for (const file of files) {
  const raw = await fs.readFile(file, "utf8");
  const { meta, body } = parseFrontMatter(raw);
  if (!isWaveC(meta, file)) continue;
  let prompt = adaptWildClawPrompt(extractPrompt(body));
  if (file.includes("03_Social")) {
    prompt +=
      "\n\nWave C social tools: use xclaw_mail_inbox, xclaw_mail_read, xclaw_mail_send for email; xclaw_chat_list for chat/Slack fixtures. Write final summary to ./results/results.md.";
  }
  const id = `wc-c-${meta.id || path.basename(file, ".md")}`;
  let fixture = null;
  if (file.includes("03_Social")) {
    const m = file.match(/task_(\d+_[a-z0-9_]+)/i);
    if (m) fixture = `wc/wc-03_Social_Interaction-task_${m[1]}`;
  }
  cases.push({
    id,
    tags: ["wildclaw", "wave-c", "autonomy", meta.category || "social"],
    name: meta.name || id,
    source: path.relative(WC, file),
    prompt,
    fixture,
    maxTurns: 30,
    timeoutMs: 600_000,
    expect: {
      soft: true,
      success: [{ type: "file_exists", path: "results" }],
    },
  });
}

await fs.mkdir(path.dirname(OUT), { recursive: true });
await fs.writeFile(OUT, JSON.stringify(cases, null, 2));
console.log(JSON.stringify({ converted: cases.length, out: OUT, ids: cases.map((c) => c.id) }, null, 2));
