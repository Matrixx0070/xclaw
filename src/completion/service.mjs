/**
 * Repo-aware code completion service.
 *
 * Fill-in-the-middle over the provider chat API with repo-intel context:
 * the target file's neighborhood (symbols of files it imports + files that
 * import it) rides along so completions match the codebase's real APIs —
 * "completion-aware" per the NEXT-LEVEL roadmap.
 *
 * Stateless per call; no store. The provider resolves exactly like agent
 * runs (registry route → createProvider), so OAuth refresh, failover and
 * cost accounting behave identically.
 */
import path from "node:path";
import fs from "node:fs/promises";
import { scanRepo, extractSymbols, extractImports } from "../intel/repo-intel.mjs";

const SYSTEM_PROMPT = [
  "You are a code-completion engine.",
  "Reply with ONLY the code to insert at <CURSOR> — no code fences, no commentary, no repetition of the surrounding code.",
  "Match the file's language, style, and indentation. Prefer short, correct completions that use the APIs shown in the repository context.",
].join(" ");

/** Strip accidental fencing/echo the model might add despite instructions. */
export function cleanCompletion(raw, { suffix = "" } = {}) {
  let s = String(raw ?? "");
  const fence = s.match(/^```[\w-]*\n([\s\S]*?)```\s*$/);
  if (fence) s = fence[1];
  s = s.replace(/^```[\w-]*\n?/, "").replace(/\n?```\s*$/, "");
  // if the model echoed the beginning of the suffix, cut it off
  const suf = String(suffix || "").trimStart();
  if (suf.length >= 8) {
    const idx = s.indexOf(suf.slice(0, 24));
    if (idx > 0) s = s.slice(0, idx);
  }
  return s.replace(/\s+$/, "");
}

/**
 * Neighborhood context: symbols from files the target imports and files
 * that import the target. Bounded by budgetChars.
 */
export async function buildCompletionContext(repoDir, file, { budgetChars = 4000, buffer = "" } = {}) {
  if (!repoDir) return { text: "", files: [] };
  let files;
  try {
    files = await scanRepo(repoDir, { maxFiles: 800 });
  } catch {
    return { text: "", files: [] };
  }
  const rel = path.isAbsolute(file) ? path.relative(repoDir, file) : file;
  const base = path.basename(rel).replace(/\.[^.]+$/, "");
  // The editor buffer (prefix) is the truth for imports — the file on disk
  // may be stale or not exist yet (new files are the common completion case).
  let targetImports = extractImports(rel, String(buffer || ""));
  try {
    const content = await fs.readFile(path.join(repoDir, rel), "utf8");
    targetImports = [...new Set([...targetImports, ...extractImports(rel, content)])];
  } catch {
    /* unsaved/new file — buffer imports + importers-of-target only */
  }
  const interesting = [];
  for (const f of files) {
    if (f.path === rel || f.kind !== "code") continue;
    const fBase = path.basename(f.path).replace(/\.[^.]+$/, "");
    const importedByTarget = targetImports.some((imp) => imp.includes(fBase));
    let importsTarget = false;
    if (!importedByTarget) {
      try {
        const c = await fs.readFile(path.join(repoDir, f.path), "utf8");
        importsTarget = extractImports(f.path, c).some((imp) => imp.includes(base));
        if (importsTarget || importedByTarget) {
          interesting.push({ file: f.path, content: c });
        }
      } catch {
        /* skip unreadable */
      }
    } else {
      try {
        interesting.push({ file: f.path, content: await fs.readFile(path.join(repoDir, f.path), "utf8") });
      } catch {
        /* skip */
      }
    }
    if (interesting.length >= 8) break;
  }
  const parts = [];
  let used = 0;
  for (const it of interesting) {
    const syms = extractSymbols(it.file, it.content)
      .slice(0, 20)
      .map((s) => `${s.kind} ${s.name}`)
      .join(", ");
    const line = `// ${it.file}: ${syms || "(no top-level symbols)"}`;
    if (used + line.length > budgetChars) break;
    parts.push(line);
    used += line.length;
  }
  return {
    text: parts.length ? `REPOSITORY CONTEXT (neighboring files → their symbols):\n${parts.join("\n")}` : "",
    files: interesting.map((i) => i.file),
  };
}

/**
 * @param {object} cfg
 * @param {{file?: string, prefix: string, suffix?: string, language?: string,
 *          repoDir?: string, maxTokens?: number, provider?: object}} opts
 */
export async function completeCode(cfg, opts = {}) {
  const prefix = String(opts.prefix ?? "");
  if (!prefix.trim()) throw new Error("prefix required");
  const suffix = String(opts.suffix ?? "");
  const file = opts.file ? String(opts.file) : null;
  const t0 = Date.now();

  let provider = opts.provider;
  if (!provider) {
    const { resolveProviderRouteAsync } = await import("../providers/registry.mjs");
    const { createProvider } = await import("../agent/provider.mjs");
    const route = await resolveProviderRouteAsync(cfg, {
      model: cfg.completion?.model || undefined,
    });
    provider = createProvider({
      apiKey: route.apiKey || cfg.agent?.apiKey,
      baseUrl: route.baseUrl,
      model: route.model || cfg.agent?.model,
      provider: route.provider,
      api: route.api,
      cfg,
    });
    provider.providerName = route.provider;
  }

  const ctx = await buildCompletionContext(opts.repoDir, file || "untitled", {
    budgetChars: cfg.completion?.contextChars ?? 4000,
    buffer: prefix,
  });

  const user = [
    ctx.text,
    ctx.text ? "" : null,
    `FILE: ${file || "untitled"}${opts.language ? ` (${opts.language})` : ""}`,
    "Insert the completion at <CURSOR>:",
    "",
    `${prefix}<CURSOR>${suffix}`,
  ]
    .filter((x) => x !== null)
    .join("\n");

  const out = await provider.chat({
    messages: [
      { role: "system", content: SYSTEM_PROMPT },
      { role: "user", content: user },
    ],
    // completions want determinism + a bounded burst
    ...(cfg.completion?.temperature !== undefined ? { temperature: cfg.completion.temperature } : {}),
  });
  const raw = out?.message?.content ?? "";
  const completion = cleanCompletion(raw, { suffix });
  return {
    completion,
    model: provider.model,
    provider: provider.providerName || null,
    contextFiles: ctx.files,
    ms: Date.now() - t0,
  };
}
