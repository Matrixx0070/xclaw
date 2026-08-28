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

/** Where the whole store lives. Exported so retention can name it out loud. */
export function memoryStoreDir(cfg) {
  return baseDir(cfg);
}

const MEMORY_MD_PATH_RE = /^Path: `(.+)`$/m;

/**
 * The workspace a memory directory belongs to, or null when it cannot be told.
 *
 * memoryPaths() keys each directory by a one-way sha256 of the workspace path,
 * so the directory name alone can never identify its owner. rebuildMemoryMd
 * has always written the path into MEMORY.md; reading it back is what makes a
 * safe retention decision possible at all. Null is a real answer — a directory
 * written before MEMORY.md existed, or one whose file was removed — and it
 * must never be treated as "gone".
 */
export async function readWorkspacePath(dir) {
  let md = "";
  try {
    md = await fs.readFile(path.join(dir, "MEMORY.md"), "utf8");
  } catch {
    return null;
  }
  const m = MEMORY_MD_PATH_RE.exec(md);
  return m ? m[1] : null;
}

async function dirBytes(dir) {
  let total = 0;
  let entries = [];
  try {
    entries = await fs.readdir(dir, { withFileTypes: true });
  } catch {
    return 0;
  }
  for (const e of entries) {
    if (!e.isFile()) continue;
    try {
      total += (await fs.stat(path.join(dir, e.name))).size;
    } catch {
      /* vanished under us */
    }
  }
  return total;
}

/**
 * Retention for the store's directories. Every append bounds its own
 * events.jsonl by rotation; nothing bounded the number of directories, one of
 * which is minted per distinct workspace path and never removed.
 *
 * Only a PROVABLE orphan is eligible: MEMORY.md names a workspace and that
 * workspace no longer exists. A directory whose workspace still resolves is
 * kept regardless of age — a long-lived workspace's memory is the only thing
 * in this store worth keeping, and age is exactly the wrong signal for it. A
 * directory whose path cannot be read is counted as unattributable and left
 * alone; "I cannot tell" is not a licence to delete.
 *
 * Both bounds sit above the live population measured at 3.317.0 (208
 * directories, oldest 13.0 days) so enabling retention deletes nothing that is
 * already on disk — the count ceiling applies to orphans only, newest first.
 * Returns the census whether or not it pruned.
 */
export async function pruneMemoryWorkspaces(cfg = {}, opts = {}) {
  const mc = cfg?.memory || {};
  const maxAgeMs = opts.maxAgeMs ?? mc.orphanMaxAgeMs ?? 30 * 86_400_000;
  const keepMax = opts.keepMax ?? mc.orphanKeepMax ?? 500;
  const dir = baseDir(cfg);
  const out = {
    dir,
    workspaces: 0,
    keepers: 0,
    orphans: 0,
    unattributable: 0,
    bytes: 0,
    pruned: 0,
    prunedBytes: 0,
    reason: "ok",
  };

  let entries;
  try {
    entries = await fs.readdir(dir, { withFileTypes: true });
  } catch {
    out.reason = "absent";
    return out;
  }

  const cutoff = Date.now() - maxAgeMs;
  const orphans = [];
  for (const e of entries) {
    if (!e.isDirectory()) continue;
    const d = path.join(dir, e.name);
    let st;
    try {
      st = await fs.stat(d);
    } catch {
      continue;
    }
    out.workspaces += 1;
    const bytes = await dirBytes(d);
    out.bytes += bytes;

    const ws = await readWorkspacePath(d);
    if (!ws) {
      out.unattributable += 1;
      continue;
    }
    const alive = await fs
      .stat(ws)
      .then(() => true)
      .catch(() => false);
    if (alive) {
      out.keepers += 1;
      continue;
    }
    out.orphans += 1;
    orphans.push({ path: d, mtimeMs: st.mtimeMs, bytes });
  }

  orphans.sort((a, b) => b.mtimeMs - a.mtimeMs); // newest first
  const doomed = orphans.filter((o, i) => o.mtimeMs < cutoff || i >= keepMax);
  for (const o of doomed) {
    try {
      await fs.rm(o.path, { recursive: true, force: true });
      out.pruned += 1;
      out.prunedBytes += o.bytes;
    } catch {
      // next pass gets it; never let one undeletable directory abort the sweep
    }
  }
  return out;
}
