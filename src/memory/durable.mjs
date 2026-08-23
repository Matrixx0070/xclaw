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
    // S7: every event gets a durable id — the addressable unit for
    // provenance links (sourceIds) and for forgetMemory. Caller-supplied
    // ids/sourceIds pass through untouched.
    id:
      event.id ||
      `mem_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`,
    ...event,
  });
  await fs.appendFile(p.jsonl, JSON.stringify(line) + "\n");
  // Bound the events log (audit 2026-08-23: unbounded growth, and every
  // append re-read the WHOLE file to rebuild memory.md). Rotation reuses the
  // ops maintenance owner; recall only ever scans the tail, so the archived
  // head ("<file>.1") loses nothing recall could see.
  try {
    const { rotateJsonlIfOversize } = await import("../ops/maintenance.mjs");
    const rot = await rotateJsonlIfOversize(p.jsonl, {
      maxBytes: cfg?.memory?.maxEventBytes ?? 1_000_000,
      keepBytes: cfg?.memory?.keepEventBytes ?? 500_000,
    });
    // E-B: rotation writes a COMPACT summary event whose sourceIds point at
    // the archived records — the provenance chain (recall-provenance) can
    // then expand a compact note back into its sources on demand instead of
    // the archive silently vanishing from recall's view.
    if (rot?.rotated) {
      const head = await fs.readFile(p.jsonl + ".1", "utf8").catch(() => "");
      const ids = [];
      const types = {};
      for (const ln of head.split("\n").filter(Boolean).slice(-2000)) {
        try {
          const ev = JSON.parse(ln);
          if (ev.id) ids.push(ev.id);
          const t = ev.type || "note";
          types[t] = (types[t] || 0) + 1;
        } catch {
          /* skip torn line */
        }
      }
      if (ids.length) {
        const compact = redactEvent({
          at: new Date().toISOString(),
          id: `mem_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`,
          type: "compact",
          summary: `Archived ${ids.length} events (${Object.entries(types)
            .map(([k, v]) => `${k}:${v}`)
            .join(", ")}) to events.jsonl.1`,
          sourceIds: ids.slice(0, 200),
        });
        await fs.appendFile(p.jsonl, JSON.stringify(compact) + "\n");
      }
    }
  } catch {
    /* rotation is best-effort */
  }
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

/**
 * S7 — forget: remove matching events from the workspace memory log and
 * rebuild memory.md. Memory that cannot forget only accumulates; wrong or
 * stale records must be deletable (audit 2026-08-23: no forget/delete API).
 *
 * Matchers (OR of provided fields is NOT the semantics — ALL provided
 * fields must match, so callers can scope precisely):
 *   { id, jobId, type, contains }  — contains matches summary/goal text.
 * Returns { removed, kept }.
 */
export async function forgetMemory(cfg, workspacePath, match = {}) {
  const p = memoryPaths(cfg, workspacePath);
  let raw = "";
  try {
    raw = await fs.readFile(p.jsonl, "utf8");
  } catch {
    return { removed: 0, kept: 0 };
  }
  const hasAny =
    match.id || match.jobId || match.type || match.contains;
  if (!hasAny) return { removed: 0, kept: 0, reason: "no_matcher" };
  const kept = [];
  let removed = 0;
  for (const line of raw.split("\n").filter(Boolean)) {
    let ev = null;
    try {
      ev = JSON.parse(line);
    } catch {
      kept.push(line); // never drop unparseable lines silently
      continue;
    }
    const text = `${ev.summary || ""} ${ev.goal || ""}`;
    const hit =
      (!match.id || String(ev.id) === String(match.id)) &&
      (!match.jobId || String(ev.jobId) === String(match.jobId)) &&
      (!match.type || ev.type === match.type) &&
      (!match.contains || text.includes(match.contains));
    if (hit) {
      removed += 1;
    } else {
      kept.push(JSON.stringify(ev));
    }
  }
  await fs.writeFile(p.jsonl, kept.length ? kept.join("\n") + "\n" : "");
  await rebuildMemoryMd(cfg, workspacePath);
  return { removed, kept: kept.length };
}
