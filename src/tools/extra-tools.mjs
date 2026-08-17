/**
 * Extra agent tools — parity with common agent UIs (glob, grep, web_fetch, web_search).
 * Executed in the gateway/agent process (not computer server).
 */
import fs from "node:fs/promises";
import path from "node:path";
import { spawn } from "node:child_process";
import { fetchWithRetry } from "../utils/fetch-retry.mjs";

function textResult(text, extra = {}) {
  return {
    content: [{ type: "text", text: String(text ?? "") }],
    ...extra,
  };
}

function errorResult(msg) {
  return {
    isError: true,
    content: [{ type: "text", text: String(msg) }],
  };
}

function resolveUnder(root, p) {
  const abs = path.isAbsolute(p) ? path.normalize(p) : path.resolve(root, p);
  const rootAbs = path.resolve(root);
  if (!abs.startsWith(rootAbs) && abs !== rootAbs) {
    // allow absolute paths outside workspace but warn in metadata
    return { abs, outside: true };
  }
  return { abs, outside: false };
}

async function walkGlob(root, pattern, { max = 500 } = {}) {
  // Prefer ripgrep files / find; fallback to recursive walk with minimatch-ish
  const results = [];
  async function walk(dir, depth = 0) {
    if (results.length >= max || depth > 20) return;
    let entries;
    try {
      entries = await fs.readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const ent of entries) {
      if (results.length >= max) break;
      if (ent.name === "node_modules" || ent.name === ".git" || ent.name === ".xclaw") continue;
      const full = path.join(dir, ent.name);
      const rel = path.relative(root, full) || ".";
      if (ent.isDirectory()) {
        await walk(full, depth + 1);
      } else if (ent.isFile()) {
        if (matchGlob(rel, pattern) || matchGlob(ent.name, pattern)) {
          results.push(rel);
        }
      }
    }
  }
  await walk(root);
  return results;
}

/** Minimal glob: * and ** and ? */
function matchGlob(name, pattern) {
  const n = name.replace(/\\/g, "/");
  const p = pattern.replace(/\\/g, "/");
  // escape regex specials except * ?
  let re = "";
  for (let i = 0; i < p.length; i++) {
    const c = p[i];
    if (c === "*" && p[i + 1] === "*") {
      re += ".*";
      i++;
      if (p[i + 1] === "/") i++;
    } else if (c === "*") {
      re += "[^/]*";
    } else if (c === "?") {
      re += "[^/]";
    } else if (".+^$()[]{}|\\".includes(c)) {
      re += "\\" + c;
    } else {
      re += c;
    }
  }
  try {
    return new RegExp("^" + re + "$", "i").test(n);
  } catch {
    return n.includes(p);
  }
}

function runCmd(cmd, args, { cwd, timeoutMs = 30_000, maxBytes = 512_000 } = {}) {
  return new Promise((resolve) => {
    const child = spawn(cmd, args, { cwd, shell: false });
    let out = "";
    let err = "";
    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      resolve({ code: -1, stdout: out, stderr: err + "\n(timeout)", timedOut: true });
    }, timeoutMs);
    child.stdout.on("data", (d) => {
      if (out.length < maxBytes) out += d.toString();
    });
    child.stderr.on("data", (d) => {
      if (err.length < maxBytes / 4) err += d.toString();
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      resolve({ code: code ?? 0, stdout: out, stderr: err, timedOut: false });
    });
    child.on("error", (e) => {
      clearTimeout(timer);
      resolve({ code: -1, stdout: out, stderr: e.message, timedOut: false });
    });
  });
}

export function createGlobTool({ workingDir }) {
  return {
    name: "glob",
    description:
      "Find files matching a glob pattern under the working directory (e.g. **/*.mjs, src/**/*.ts).",
    parameters: {
      type: "object",
      properties: {
        pattern: { type: "string", description: "Glob pattern" },
        path: { type: "string", description: "Root directory (default: workspace)" },
        max: { type: "number", description: "Max matches (default 500)" },
      },
      required: ["pattern"],
    },
    async execute(args = {}) {
      const pattern = String(args.pattern || "").trim();
      if (!pattern) return errorResult("pattern is required");
      const root = args.path
        ? resolveUnder(workingDir, args.path).abs
        : path.resolve(workingDir);
      const max = Math.min(Number(args.max) || 500, 2000);

      // Try rg --files + filter for speed
      const rg = await runCmd("rg", ["--files", "-g", pattern, root], {
        cwd: root,
        timeoutMs: 20_000,
      });
      if (rg.code === 0 && rg.stdout.trim()) {
        const lines = rg.stdout
          .split("\n")
          .map((l) => l.trim())
          .filter(Boolean)
          .map((l) => (l.startsWith(root) ? path.relative(root, l) : l))
          .slice(0, max);
        return textResult(lines.join("\n") || "(no matches)", {
          metadata: { count: lines.length, pattern, root, engine: "rg" },
        });
      }

      const found = await walkGlob(root, pattern, { max });
      return textResult(found.join("\n") || "(no matches)", {
        metadata: { count: found.length, pattern, root, engine: "walk" },
      });
    },
  };
}

export function createGrepTool({ workingDir }) {
  return {
    name: "grep",
    description:
      "Search file contents with a regex/pattern (ripgrep). Returns matching lines with paths.",
    parameters: {
      type: "object",
      properties: {
        pattern: { type: "string", description: "Search pattern (regex)" },
        path: { type: "string", description: "File or directory to search" },
        glob: { type: "string", description: "Optional file glob filter e.g. *.mjs" },
        case_insensitive: { type: "boolean" },
        max_matches: { type: "number" },
      },
      required: ["pattern"],
    },
    async execute(args = {}) {
      const pattern = String(args.pattern || "");
      if (!pattern) return errorResult("pattern is required");
      const searchPath = args.path
        ? resolveUnder(workingDir, args.path).abs
        : path.resolve(workingDir);
      const max = Math.min(Number(args.max_matches) || 200, 1000);
      const rgArgs = ["-n", "--no-heading", "--color", "never", "-m", String(max)];
      if (args.case_insensitive) rgArgs.push("-i");
      if (args.glob) {
        rgArgs.push("-g", String(args.glob));
      }
      rgArgs.push(pattern, searchPath);

      const rg = await runCmd("rg", rgArgs, { cwd: workingDir, timeoutMs: 30_000 });
      if (rg.timedOut) return errorResult("grep timed out");
      // rg exit 1 = no matches
      if (rg.code !== 0 && rg.code !== 1 && !rg.stdout) {
        // fallback grep
        const gArgs = ["-R", "-n", "-E"];
        if (args.case_insensitive) gArgs.push("-i");
        gArgs.push(pattern, searchPath);
        const g = await runCmd("grep", gArgs, { cwd: workingDir, timeoutMs: 30_000 });
        const lines = (g.stdout || "").split("\n").filter(Boolean).slice(0, max);
        return textResult(lines.join("\n") || "(no matches)", {
          metadata: { count: lines.length, engine: "grep", code: g.code },
        });
      }
      const lines = (rg.stdout || "").split("\n").filter(Boolean).slice(0, max);
      return textResult(lines.join("\n") || "(no matches)", {
        metadata: { count: lines.length, engine: "rg", code: rg.code },
      });
    },
  };
}

export function createWebFetchTool() {
  return {
    name: "web_fetch",
    description:
      "Fetch a URL and return text content (HTML stripped lightly, or raw). For reading pages/APIs.",
    parameters: {
      type: "object",
      properties: {
        url: { type: "string" },
        max_chars: { type: "number", description: "Truncate to this many chars (default 50000)" },
        headers: { type: "object", description: "Optional request headers" },
      },
      required: ["url"],
    },
    async execute(args = {}) {
      const url = String(args.url || "").trim();
      if (!url || !/^https?:\/\//i.test(url)) {
        return errorResult("url must be http(s)");
      }
      const max = Math.min(Number(args.max_chars) || 50_000, 200_000);
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), 25_000);
      try {
        const headers = {
          "User-Agent": "XClaw/2.5 (web_fetch)",
          Accept: "text/html,application/xhtml+xml,application/json,text/plain,*/*",
          ...(args.headers || {}),
        };
        const res = await fetchWithRetry(url, { headers, signal: ctrl.signal, redirect: "follow" });
        clearTimeout(timer);
        const ct = res.headers.get("content-type") || "";
        let body = await res.text();
        if (ct.includes("html")) {
          body = body
            .replace(/<script[\s\S]*?<\/script>/gi, " ")
            .replace(/<style[\s\S]*?<\/style>/gi, " ")
            .replace(/<[^>]+>/g, " ")
            .replace(/\s+/g, " ")
            .trim();
        }
        if (body.length > max) body = body.slice(0, max) + "\n…[truncated]";
        return textResult(body, {
          metadata: { status: res.status, contentType: ct, url: res.url, chars: body.length },
        });
      } catch (err) {
        clearTimeout(timer);
        return errorResult(err.message || String(err));
      }
    },
  };
}

export function createWebSearchTool() {
  return {
    name: "web_search",
    description:
      "Search the web and return top results (title, url, snippet). Uses DuckDuckGo Instant Answer + HTML fallback.",
    parameters: {
      type: "object",
      properties: {
        query: { type: "string" },
        num_results: { type: "number", description: "Max results (default 8)" },
      },
      required: ["query"],
    },
    async execute(args = {}) {
      const query = String(args.query || "").trim();
      if (!query) return errorResult("query is required");
      const limit = Math.min(Number(args.num_results) || 8, 15);
      const results = [];

      // 1) DuckDuckGo Instant Answer API
      try {
        const u = new URL("https://api.duckduckgo.com/");
        u.searchParams.set("q", query);
        u.searchParams.set("format", "json");
        u.searchParams.set("no_html", "1");
        u.searchParams.set("skip_disambig", "1");
        const res = await fetchWithRetry(u.toString(), {
          headers: { "User-Agent": "XClaw/2.5" },
          signal: AbortSignal.timeout(12_000),
        });
        if (res.ok) {
          const j = await res.json();
          if (j.AbstractText) {
            results.push({
              title: j.Heading || query,
              url: j.AbstractURL || j.AbstractSource || "",
              snippet: j.AbstractText,
            });
          }
          for (const t of j.RelatedTopics || []) {
            if (results.length >= limit) break;
            if (t.Text && t.FirstURL) {
              results.push({ title: t.Text.slice(0, 80), url: t.FirstURL, snippet: t.Text });
            }
            for (const tt of t.Topics || []) {
              if (results.length >= limit) break;
              if (tt.Text && tt.FirstURL) {
                results.push({ title: tt.Text.slice(0, 80), url: tt.FirstURL, snippet: tt.Text });
              }
            }
          }
        }
      } catch {
        /* */
      }

      // 2) HTML lite fallback
      if (results.length < 3) {
        try {
          const u = `https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`;
          const res = await fetchWithRetry(u, {
            headers: {
              "User-Agent": "Mozilla/5.0 (compatible; XClaw/2.5)",
              Accept: "text/html",
            },
            signal: AbortSignal.timeout(15_000),
          });
          if (res.ok) {
            const html = await res.text();
            const re =
              /class="result__a"[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>[\s\S]*?class="result__snippet"[^>]*>([\s\S]*?)<\/(?:a|td|div)/gi;
            let m;
            while ((m = re.exec(html)) && results.length < limit) {
              const href = m[1].replace(/&amp;/g, "&");
              // DDG redirect links
              let url = href;
              try {
                const uddg = new URL(href, "https://html.duckduckgo.com");
                if (uddg.searchParams.get("uddg")) url = uddg.searchParams.get("uddg");
              } catch {
                /* */
              }
              const title = m[2].replace(/<[^>]+>/g, "").trim();
              const snippet = m[3].replace(/<[^>]+>/g, "").trim();
              if (title && url) results.push({ title, url, snippet });
            }
          }
        } catch {
          /* */
        }
      }

      if (!results.length) {
        return textResult(`No results for: ${query}`, { metadata: { count: 0, query } });
      }
      const lines = results.slice(0, limit).map(
        (r, i) => `${i + 1}. ${r.title}\n   ${r.url}\n   ${r.snippet || ""}`
      );
      return textResult(lines.join("\n\n"), {
        metadata: { count: results.length, query, results: results.slice(0, limit) },
      });
    },
  };
}

/**
 * Create the four extra tools bound to a workspace.
 */
export function createExtraTools({ workingDir, cfg } = {}) {
  const wd = workingDir || process.cwd();
  return [
    createGlobTool({ workingDir: wd }),
    createGrepTool({ workingDir: wd }),
    createWebFetchTool(),
    createWebSearchTool(),
  ];
}

export function extraToolsAsOpenAI(tools) {
  return tools.map((t) => ({
    type: "function",
    function: {
      name: t.name,
      description: t.description,
      parameters: t.parameters || { type: "object", properties: {} },
    },
  }));
}
