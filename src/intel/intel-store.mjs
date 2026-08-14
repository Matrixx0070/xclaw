/**
 * Persistent repo intelligence (Mandate-2 slice B1).
 *
 * A per-repo incremental index under ~/.xclaw/intel/<repo-key>/ so agents stop
 * rediscovering the same repository every run:
 *   index.json  — per-file {mtimeMs,size,kind,symbols,imports} + hot + importedBy
 *   notes.jsonl — deterministic facts from completed missions (files touched,
 *                 verify commands that passed)
 *   brief.md    — the compounding extractive repo brief
 *
 * Keying: sha256(git common dir) — a mission WORKTREE shares its main repo's
 * index, which is exactly the cross-run compounding this slice exists for.
 * Non-git dirs fall back to their resolved path.
 *
 * Deliberately not built: embeddings/vector DB, per-language AST parsers,
 * per-file LLM summaries. The index stores cheap deterministic facts; the
 * model does the understanding.
 */
import fs from "node:fs/promises";
import path from "node:path";
import crypto from "node:crypto";
import { spawn } from "node:child_process";
import { getConfigDir } from "../config/load.mjs";
import {
  scanRepo,
  extractSymbols,
  extractImports,
  searchLexical,
  gitHotFiles,
  taskKeywords,
  scoreFiles,
  assembleContext,
} from "./repo-intel.mjs";

const INDEX_VERSION = 1;
const REBUILD_CHURN = 0.3;

function run(cmd, args, cwd, timeoutMs = 10_000) {
  return new Promise((resolve) => {
    const child = spawn(cmd, args, { cwd });
    let stdout = "";
    const timer = setTimeout(() => {
      try { child.kill("SIGKILL"); } catch {}
    }, timeoutMs);
    child.stdout?.on("data", (d) => (stdout += d));
    child.on("close", (code) => {
      clearTimeout(timer);
      resolve({ code: code ?? 1, stdout });
    });
    child.on("error", () => {
      clearTimeout(timer);
      resolve({ code: 1, stdout });
    });
  });
}

/** Stable key: worktrees of one repo share the main repo's index. */
export async function repoKey(repoDir) {
  const r = await run("git", ["rev-parse", "--path-format=absolute", "--git-common-dir"], repoDir);
  const anchor =
    r.code === 0 && r.stdout.trim()
      ? r.stdout.trim()
      : path.resolve(repoDir);
  return crypto.createHash("sha256").update(anchor).digest("hex").slice(0, 16);
}

export function intelRoot(cfg = {}) {
  return (
    cfg.intel?.dir || path.join(cfg.paths?.configDir || getConfigDir(), "intel")
  );
}

async function gitHead(repoDir) {
  const r = await run("git", ["rev-parse", "HEAD"], repoDir);
  return r.code === 0 ? r.stdout.trim() : null;
}

function testsMap(files, importsByPath) {
  // test file → source files it imports (resolved relative imports only)
  const known = new Set(files.map((f) => f.path));
  const map = {};
  for (const f of files) {
    if (!/(^|\/)(test|tests|spec|__tests__)\//i.test(f.path) && !/\.(test|spec)\./i.test(f.path)) continue;
    const targets = [];
    for (const imp of importsByPath[f.path] || []) {
      if (!imp.startsWith(".")) continue;
      const resolved = path
        .normalize(path.join(path.dirname(f.path), imp))
        .replace(/\\/g, "/");
      for (const cand of [resolved, `${resolved}.js`, `${resolved}.mjs`, `${resolved}.ts`, `${resolved}/index.js`]) {
        if (known.has(cand)) {
          targets.push(cand);
          break;
        }
      }
    }
    if (targets.length) map[f.path] = targets;
  }
  return map;
}

function computeImportedBy(files, importsByPath) {
  const known = new Set(files.map((f) => f.path));
  const importedBy = {};
  for (const f of files) {
    for (const imp of importsByPath[f.path] || []) {
      if (!imp.startsWith(".")) continue;
      const resolved = path
        .normalize(path.join(path.dirname(f.path), imp))
        .replace(/\\/g, "/");
      for (const cand of [resolved, `${resolved}.js`, `${resolved}.mjs`, `${resolved}.ts`, `${resolved}/index.js`]) {
        if (known.has(cand)) {
          importedBy[cand] = (importedBy[cand] || 0) + 1;
          break;
        }
      }
    }
  }
  return importedBy;
}

export async function openIntelStore(cfg, repoDir) {
  const key = await repoKey(repoDir);
  const dir = path.join(intelRoot(cfg), key);
  const indexPath = path.join(dir, "index.json");
  const notesPath = path.join(dir, "notes.jsonl");
  const briefPath = path.join(dir, "brief.md");

  async function loadIndex() {
    try {
      const idx = JSON.parse(await fs.readFile(indexPath, "utf8"));
      if (idx.version !== INDEX_VERSION) return null;
      return idx;
    } catch {
      return null;
    }
  }

  async function saveIndex(idx) {
    await fs.mkdir(dir, { recursive: true });
    const tmp = `${indexPath}.tmp`;
    await fs.writeFile(tmp, JSON.stringify(idx), "utf8");
    await fs.rename(tmp, indexPath);
  }

  /**
   * Incremental refresh: stat-diff against the stored index, re-extract only
   * changed files; git-heat refresh only on HEAD change; full rebuild on
   * version mismatch, corruption, or >30% churn.
   */
  async function ensureFresh() {
    const t0 = Date.now();
    const files = await scanRepo(repoDir);
    let idx = await loadIndex();
    const prev = idx?.files || {};
    let changed = [];
    let removed = [];
    if (idx) {
      const seen = new Set();
      for (const f of files) {
        seen.add(f.path);
        const p = prev[f.path];
        if (!p || p.size !== f.bytes) changed.push(f);
        else {
          // stat mtime only when size matches (cheap short-circuit)
          try {
            const st = await fs.stat(path.join(repoDir, f.path));
            if (st.mtimeMs !== p.mtimeMs) changed.push(f);
          } catch {
            changed.push(f);
          }
        }
      }
      removed = Object.keys(prev).filter((p) => !seen.has(p));
      // Heavy churn → rebuild from scratch. Only bother when the repo is big
      // enough for incremental bookkeeping to matter; tiny repos would trip
      // this on every single-file edit (1/3 files = 33% "churn").
      if (
        files.length > 50 &&
        (changed.length + removed.length) / files.length > REBUILD_CHURN
      ) {
        idx = null;
      }
    }
    if (!idx) {
      idx = { version: INDEX_VERSION, head: null, builtAt: null, files: {}, hot: {}, importedBy: {}, testsMap: {} };
      changed = files;
      removed = [];
    }

    for (const rel of removed) delete idx.files[rel];
    // scanRepo already bounds total files (2000) — no second cap here, or the
    // overflow would be re-flagged as "changed" on every pass forever.
    for (const f of changed.filter((x) => x.kind === "code")) {
      try {
        const full = path.join(repoDir, f.path);
        const content = await fs.readFile(full, "utf8");
        const st = await fs.stat(full);
        idx.files[f.path] = {
          mtimeMs: st.mtimeMs,
          size: f.bytes,
          kind: f.kind,
          symbols: extractSymbols(f.path, content),
          imports: extractImports(f.path, content),
        };
      } catch {
        /* unreadable — drop from index */
        delete idx.files[f.path];
      }
    }
    for (const f of changed.filter((x) => x.kind !== "code")) {
      let mtimeMs = 0;
      try {
        mtimeMs = (await fs.stat(path.join(repoDir, f.path))).mtimeMs;
      } catch {
        continue;
      }
      idx.files[f.path] = { mtimeMs, size: f.bytes, kind: f.kind, symbols: [], imports: [] };
    }

    const head = await gitHead(repoDir);
    if (head !== idx.head) {
      const hot = await gitHotFiles(repoDir).catch(() => new Map());
      idx.hot = Object.fromEntries(hot);
      idx.head = head;
    }
    if (changed.length || removed.length || !idx.builtAt) {
      const importsByPath = Object.fromEntries(
        Object.entries(idx.files).map(([p, v]) => [p, v.imports || []])
      );
      idx.importedBy = computeImportedBy(files, importsByPath);
      idx.testsMap = testsMap(files, importsByPath);
      idx.builtAt = new Date().toISOString();
      await saveIndex(idx);
    }
    return {
      idx,
      files,
      refresh: { changed: changed.length, removed: removed.length, ms: Date.now() - t0, cold: !Object.keys(prev).length },
    };
  }

  /** Warm, ranked task context — reads only the files that make the cut. */
  async function query(task, { budgetChars = 24_000, withBrief = true } = {}) {
    const { idx, files, refresh } = await ensureFresh();
    const kws = taskKeywords(task);
    const hitCounts = new Map();
    for (const kw of kws.slice(0, 6)) {
      const hits = await searchLexical(repoDir, kw, { limit: 30 }).catch(() => []);
      for (const h of hits) hitCounts.set(h.path, (hitCounts.get(h.path) || 0) + 1);
    }
    const symbolIndex = {};
    for (const [p, v] of Object.entries(idx.files)) symbolIndex[p] = v.symbols || [];
    const scored = scoreFiles(files, {
      kws,
      hitCounts,
      importedBy: idx.importedBy,
      symbolIndex,
      hot: idx.hot,
    });
    let header = null;
    if (withBrief) {
      const b = await brief().catch(() => null);
      if (b) header = `# Repo brief (compounded from prior runs)\n${b}\n`;
    }
    const asm = await assembleContext(repoDir, scored, {
      budgetChars,
      kws,
      allFiles: files,
      header,
      readFile: async (rel) => {
        try {
          return await fs.readFile(path.join(repoDir, rel), "utf8");
        } catch {
          return null;
        }
      },
    });
    return {
      contextText: asm.contextText,
      files: asm.included,
      stats: { totalFiles: files.length, keywords: kws, chars: asm.chars, refresh },
    };
  }

  /** Deterministic fact from a completed run — the compounding input. */
  async function addNote(note) {
    await fs.mkdir(dir, { recursive: true });
    const line = JSON.stringify({ at: new Date().toISOString(), ...note });
    await fs.appendFile(notesPath, line + "\n", "utf8");
  }

  async function readNotes(limit = 50) {
    try {
      const text = await fs.readFile(notesPath, "utf8");
      return text
        .split("\n")
        .filter(Boolean)
        .slice(-limit)
        .map((l) => {
          try {
            return JSON.parse(l);
          } catch {
            return null;
          }
        })
        .filter(Boolean);
    } catch {
      return [];
    }
  }

  /**
   * The compounding repo brief — extractive, regenerated on demand from the
   * index + notes. (B2 wires an optional LLM polish via summarizeFn; the
   * extractive form always works.)
   */
  async function brief({ regenerate = false } = {}) {
    if (!regenerate) {
      try {
        return await fs.readFile(briefPath, "utf8");
      } catch {
        /* fall through to generate */
      }
    }
    const idx = (await loadIndex()) || { files: {}, importedBy: {}, hot: {} };
    const notes = await readNotes(10);
    const topImported = Object.entries(idx.importedBy || {})
      .sort((a, b) => b[1] - a[1])
      .slice(0, 8)
      .map(([p, n]) => `- ${p} (imported by ${n})`);
    const topHot = Object.entries(idx.hot || {})
      .sort((a, b) => b[1] - a[1])
      .slice(0, 8)
      .map(([p, n]) => `- ${p} (${n} recent changes)`);
    const verifyCmds = [
      ...new Set(notes.flatMap((n) => n.verifyCommands || [])),
    ].slice(0, 6);
    const recent = notes
      .slice(-6)
      .map((n) => `- ${String(n.at).slice(0, 10)} ${n.kind}: ${String(n.goal || "").slice(0, 100)} (${n.ok ? "ok" : "failed"})`);
    const text = [
      `Central modules (import in-degree):`,
      ...(topImported.length ? topImported : ["- (none indexed yet)"]),
      ``,
      `Hot files (recent git churn):`,
      ...(topHot.length ? topHot : ["- (no git history)"]),
      verifyCmds.length ? `\nVerify commands that passed here:\n${verifyCmds.map((c) => `- ${c}`).join("\n")}` : "",
      recent.length ? `\nRecent missions:\n${recent.join("\n")}` : "",
    ]
      .filter(Boolean)
      .join("\n");
    try {
      await fs.mkdir(dir, { recursive: true });
      await fs.writeFile(briefPath, text, "utf8");
    } catch {
      /* brief is best-effort */
    }
    return text;
  }

  async function symbols(name) {
    const idx = await loadIndex();
    if (!idx) return [];
    const needle = String(name).toLowerCase();
    const out = [];
    for (const [p, v] of Object.entries(idx.files)) {
      for (const s of v.symbols || []) {
        if (s.name.toLowerCase().includes(needle)) {
          out.push({ path: p, ...s });
          if (out.length >= 50) return out;
        }
      }
    }
    return out;
  }

  return {
    key,
    dir,
    ensureFresh,
    query,
    addNote,
    readNotes,
    brief,
    symbols,
    search: (q, opts) => searchLexical(repoDir, q, opts),
  };
}
