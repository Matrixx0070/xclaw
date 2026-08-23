/**
 * Durable workspace memory — survives jobs across sessions.
 * Store: ~/.xclaw/memory/<workspace-hash>/events.jsonl + MEMORY.md
 */
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import crypto from "node:crypto";
import { redactEvent, redactString } from "../security/redact-secrets.mjs";

function baseDir(cfg) {
  return path.join(cfg?.paths?.configDir || path.join(os.homedir(), ".xclaw"), "memory");
}

export function workspaceKey(workspacePath) {
  const norm = path.resolve(workspacePath || process.cwd());
  const h = crypto.createHash("sha256").update(norm).digest("hex").slice(0, 16);
  return { key: h, path: norm };
}

export function memoryPaths(cfg, workspacePath) {
  const { key, path: ws } = workspaceKey(workspacePath);
  const dir = path.join(baseDir(cfg), key);
  return {
    key,
    workspace: ws,
    dir,
    jsonl: path.join(dir, "events.jsonl"),
    md: path.join(dir, "MEMORY.md"),
  };
}

export async function appendMemory(cfg, workspacePath, event) {
  const p = memoryPaths(cfg, workspacePath);
  await fs.mkdir(p.dir, { recursive: true });
  const line = redactEvent({
    at: new Date().toISOString(),
    ...event,
  });
  await fs.appendFile(p.jsonl, JSON.stringify(line) + "\n");
  await rebuildMemoryMd(cfg, workspacePath);
  return line;
}

export async function listMemory(cfg, workspacePath, { limit = 50 } = {}) {
  const p = memoryPaths(cfg, workspacePath);
  let raw = "";
  try {
    raw = await fs.readFile(p.jsonl, "utf8");
  } catch {
    return [];
  }
  const items = [];
  for (const line of raw.split("\n").filter(Boolean)) {
    try {
      items.push(JSON.parse(line));
    } catch {
      /* */
    }
  }
  return items.slice(-limit).reverse();
}

export async function rebuildMemoryMd(cfg, workspacePath) {
  const p = memoryPaths(cfg, workspacePath);
  const items = await listMemory(cfg, workspacePath, { limit: 30 });
  const lines = [
    "# Workspace memory",
    "",
    "Path: `" + p.workspace + "`",
    "",
  ];
  for (const it of items) {
    const tag = it.type || "note";
    lines.push(redactString("- **" + tag + "** (" + String(it.at || "").slice(0, 19) + "): " + String(it.summary || it.goal || "").slice(0, 200)));
    if (it.proposal) lines.push(redactString("  - skill proposal: `" + it.proposal + "`"));
  }
  lines.push("");
  await fs.mkdir(p.dir, { recursive: true });
  await fs.writeFile(p.md, lines.join("\n"));
  return p.md;
}

export async function loadDurableMemoryFile(cfg, workspacePath) {
  const p = memoryPaths(cfg, workspacePath);
  try {
    const content = await fs.readFile(p.md, "utf8");
    if (!content.trim()) return null;
    const body = redactString(content.trim());
    return {
      path: p.md,
      name: "MEMORY.md",
      body,
      source: "durable",
      content: body,
    };
  } catch {
    return null;
  }
}

export async function rememberJob(cfg, job, extra = {}) {
  if (!job?.workspace) return null;
  // Provenance in the record type: only a deterministically-verified success
  // earns "job_ok". A model-self-declared pass is durable but labeled — it
  // must never read back as proven success (audit 2026-08-23).
  const verified = job.verdict === "verified";
  const type = job.pass ? (verified ? "job_ok" : "job_ok_unverified") : "job_fail";
  return appendMemory(cfg, job.workspace, {
    type,
    goal: String(job.goal || "").slice(0, 300),
    status: job.status,
    verdict: job.verdict || null,
    turns: job.turns,
    summary: job.pass
      ? (verified ? "Succeeded (verified): " : "Succeeded (unverified): ") +
        String(job.goal || "").slice(0, 120)
      : "Failed: " + (job.error || job.status) + " — " + String(job.goal || "").slice(0, 100),
    proposal: extra.proposal || job.proposal || null,
    jobId: job.id,
  });
}
