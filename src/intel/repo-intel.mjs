/**
 * Repo intelligence — the context layer for engineering missions.
 *
 * Not vector-RAG: combines repo structure, lightweight symbol extraction,
 * import graphs, lexical search, and git change-frequency to assemble the
 * RIGHT context for a task instead of dumping code into the model.
 * Zero-dep: regex symbol extraction (js/ts/mjs/cjs/py/go/rs/java), `git` for
 * history, filesystem for everything else.
 */
import fs from "node:fs/promises";
import path from "node:path";
import { spawn } from "node:child_process";

const CODE_EXT = new Set([
  ".js", ".mjs", ".cjs", ".ts", ".tsx", ".jsx", ".py", ".go", ".rs", ".java",
  ".rb", ".php", ".c", ".h", ".cpp", ".cs", ".sh", ".sql",
  // UI surface — element resolution + missions against front-end repos
  ".html", ".htm", ".css", ".scss", ".less", ".vue", ".svelte",
]);
const DOC_EXT = new Set([".md", ".txt", ".rst"]);
const CFG_FILES = new Set([
  "package.json", "tsconfig.json", "pyproject.toml", "go.mod", "Cargo.toml",
  "Makefile", "docker-compose.yml", "Dockerfile", ".eslintrc.json",
]);
const SKIP_DIRS = new Set([
  "node_modules", ".git", "dist", "build", "out", "coverage", ".next",
  "vendor", "__pycache__", ".venv", "venv", "target",
]);

function run(cmd, args, cwd, timeoutMs = 15_000) {
  return new Promise((resolve) => {
    const child = spawn(cmd, args, { cwd });
    let stdout = "";
    let stderr = "";
    const timer = setTimeout(() => {
      try { child.kill("SIGKILL"); } catch {}
    }, timeoutMs);
    child.stdout?.on("data", (d) => (stdout += d));
    child.stderr?.on("data", (d) => (stderr += d));
    child.on("close", (code) => {
      clearTimeout(timer);
      resolve({ code: code ?? 1, stdout, stderr });
    });
    child.on("error", (e) => {
      clearTimeout(timer);
      resolve({ code: 1, stdout, stderr: e.message });
    });
  });
}

/** Walk the repo (bounded) — returns [{path, ext, bytes, lines?}] */
export async function scanRepo(repoDir, { maxFiles = 2000, maxBytes = 512_000 } = {}) {
  const files = [];
  async function walk(dir, depth) {
    if (files.length >= maxFiles || depth > 8) return;
    let entries;
    try {
      entries = await fs.readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      if (files.length >= maxFiles) return;
      if (e.name.startsWith(".") && e.name !== ".env.example") {
        if (e.isDirectory()) continue;
      }
      const full = path.join(dir, e.name);
      if (e.isDirectory()) {
        if (!SKIP_DIRS.has(e.name)) await walk(full, depth + 1);
        continue;
      }
      const ext = path.extname(e.name).toLowerCase();
      const interesting =
        CODE_EXT.has(ext) || DOC_EXT.has(ext) || CFG_FILES.has(e.name);
      if (!interesting) continue;
      try {
        const st = await fs.stat(full);
        if (st.size > maxBytes) continue;
        files.push({
          path: path.relative(repoDir, full),
          ext,
          bytes: st.size,
          kind: CODE_EXT.has(ext) ? "code" : DOC_EXT.has(ext) ? "doc" : "config",
        });
      } catch {
        /* raced */
      }
    }
  }
  await walk(repoDir, 0);
  return files;
}

/** Regex symbol extraction — good enough to rank and orient, not to compile. */
export function extractSymbols(relPath, content) {
  const out = [];
  const push = (kind, name, line) => {
    if (name) out.push({ kind, name, line });
  };
  const lines = content.split("\n");
  const patterns = [
    [/^\s*(?:export\s+)?(?:async\s+)?function\s*\*?\s*([A-Za-z_$][\w$]*)/, "function"],
    [/^\s*(?:export\s+)?class\s+([A-Za-z_$][\w$]*)/, "class"],
    [/^\s*(?:export\s+)?const\s+([A-Za-z_$][\w$]*)\s*=\s*(?:async\s*)?(?:\(|function)/, "function"],
    [/^\s*def\s+([A-Za-z_]\w*)\s*\(/, "function"],
    [/^\s*class\s+([A-Za-z_]\w*)\s*[(:]/, "class"],
    [/^\s*func\s+(?:\([^)]*\)\s*)?([A-Za-z_]\w*)\s*\(/, "function"],
    [/^\s*(?:pub\s+)?fn\s+([A-Za-z_]\w*)/, "function"],
    [/^\s*(?:pub\s+)?struct\s+([A-Za-z_]\w*)/, "class"],
    [/^module\.exports(?:\.([A-Za-z_$][\w$]*))?\s*=/, "export"],
  ];
  for (let i = 0; i < lines.length && out.length < 200; i++) {
    for (const [re, kind] of patterns) {
      const m = lines[i].match(re);
      if (m) {
        push(kind, m[1] || "(default)", i + 1);
        break;
      }
    }
  }
  return out;
}

/** Imports per file (js/ts require+import, py import) → relative targets. */
export function extractImports(relPath, content) {
  const out = new Set();
  const res = [
    /import\s+(?:[\s\S]*?)\s+from\s+["']([^"']+)["']/g,
    /import\s*\(\s*["']([^"']+)["']\s*\)/g,
    /require\s*\(\s*["']([^"']+)["']\s*\)/g,
    /^from\s+(\S+)\s+import/gm,
    /^import\s+([\w.]+)/gm,
  ];
  for (const re of res) {
    let m;
    while ((m = re.exec(content))) out.add(m[1]);
  }
  return [...out];
}

/** Lexical search via git grep (fast, respects the repo) with grep fallback. */
export async function searchLexical(repoDir, query, { limit = 40 } = {}) {
  const safe = String(query).slice(0, 200);
  let r = await run("git", ["grep", "-n", "-i", "--max-depth", "8", safe], repoDir);
  if (r.code !== 0 && !r.stdout) {
    r = await run("grep", ["-rn", "-i", "--include=*.*", safe, "."], repoDir);
  }
  return r.stdout
    .split("\n")
    .filter(Boolean)
    .slice(0, limit)
    .map((line) => {
      const m = line.match(/^(?:\.\/)?([^:]+):(\d+):(.*)$/);
      return m ? { path: m[1], line: Number(m[2]), text: m[3].slice(0, 200) } : null;
    })
    .filter(Boolean);
}

/** Change-frequency from git history (hot files change together with bugs). */
export async function gitHotFiles(repoDir, { commits = 50 } = {}) {
  const r = await run(
    "git",
    ["log", `-${commits}`, "--name-only", "--pretty=format:"],
    repoDir
  );
  const counts = new Map();
  for (const line of r.stdout.split("\n")) {
    const f = line.trim();
    if (!f) continue;
    counts.set(f, (counts.get(f) || 0) + 1);
  }
  return counts;
}

function keywords(task) {
  const stop = new Set(
    "the a an and or of to in for on with is are be this that it as at by from into make fix add remove update refactor change ensure should must can will use using file files code test tests".split(" ")
  );
  return [
    ...new Set(
      String(task)
        .toLowerCase()
        .split(/[^a-z0-9_]+/)
        .filter((w) => w.length > 2 && !stop.has(w))
    ),
  ].slice(0, 12);
}

/**
 * Build the task context — the mission planner's food.
 * Ranks files by lexical hits, symbol matches, import centrality, git heat
 * and kind, then assembles a bounded context string.
 */
export async function buildTaskContext(repoDir, task, { budgetChars = 24_000 } = {}) {
  const files = await scanRepo(repoDir);
  const kws = keywords(task);
  const hot = await gitHotFiles(repoDir).catch(() => new Map());

  // lexical pass over keywords (bounded)
  const hitCounts = new Map();
  for (const kw of kws.slice(0, 6)) {
    const hits = await searchLexical(repoDir, kw, { limit: 30 }).catch(() => []);
    for (const h of hits) {
      hitCounts.set(h.path, (hitCounts.get(h.path) || 0) + 1);
    }
  }

  // read code files once for symbols + imports (bounded)
  const contentCache = new Map();
  const importedBy = new Map();
  const symbolIndex = new Map();
  for (const f of files.filter((x) => x.kind === "code").slice(0, 400)) {
    try {
      const content = await fs.readFile(path.join(repoDir, f.path), "utf8");
      contentCache.set(f.path, content);
      symbolIndex.set(f.path, extractSymbols(f.path, content));
      for (const imp of extractImports(f.path, content)) {
        if (!imp.startsWith(".")) continue;
        const resolved = path
          .normalize(path.join(path.dirname(f.path), imp))
          .replace(/\\/g, "/");
        for (const cand of [resolved, `${resolved}.js`, `${resolved}.mjs`, `${resolved}.ts`, `${resolved}/index.js`]) {
          if (files.some((x) => x.path === cand)) {
            importedBy.set(cand, (importedBy.get(cand) || 0) + 1);
            break;
          }
        }
      }
    } catch {
      /* unreadable */
    }
  }

  const scored = files
    .map((f) => {
      const symbols = symbolIndex.get(f.path) || [];
      const symbolHits = symbols.filter((s) =>
        kws.some((kw) => s.name.toLowerCase().includes(kw))
      ).length;
      const pathHits = kws.filter((kw) => f.path.toLowerCase().includes(kw)).length;
      const score =
        (hitCounts.get(f.path) || 0) * 3 +
        symbolHits * 4 +
        pathHits * 4 +
        (importedBy.get(f.path) || 0) * 2 +
        Math.min(hot.get(f.path) || 0, 5) +
        (f.kind === "config" ? 1 : 0) +
        (/test/i.test(f.path) ? 1 : 0);
      return { ...f, score, symbols };
    })
    .sort((a, b) => b.score - a.score);

  // assemble
  const parts = [];
  parts.push(
    `# Repository context (${path.basename(repoDir)}) — ${files.length} files\n` +
      `Task keywords: ${kws.join(", ") || "(none)"}\n`
  );
  const tree = files
    .slice(0, 200)
    .map((f) => `  ${f.path}`)
    .join("\n");
  parts.push(`## File tree (top ${Math.min(files.length, 200)})\n${tree}\n`);

  let used = parts.join("\n").length;
  const included = [];
  for (const f of scored) {
    if (f.score <= 0 && included.length >= 3) break;
    const content = contentCache.get(f.path);
    let block;
    if (content && content.length <= 6000) {
      block = `## ${f.path} (full)\n\`\`\`\n${content}\n\`\`\`\n`;
    } else if (content) {
      const syms = (f.symbols || [])
        .map((s) => `  ${s.kind} ${s.name} (line ${s.line})`)
        .join("\n");
      block = `## ${f.path} (head + symbols)\n\`\`\`\n${content.slice(0, 2500)}\n…\n\`\`\`\nSymbols:\n${syms}\n`;
    } else {
      block = `## ${f.path} (${f.kind}, ${f.bytes} bytes — not inlined)\n`;
    }
    if (used + block.length > budgetChars) continue;
    used += block.length;
    parts.push(block);
    included.push({ path: f.path, score: f.score });
    if (included.length >= 12) break;
  }

  return {
    contextText: parts.join("\n"),
    files: included,
    stats: {
      totalFiles: files.length,
      keywords: kws,
      chars: used,
    },
  };
}
