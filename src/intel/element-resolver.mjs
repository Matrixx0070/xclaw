/**
 * Element → source resolver for point-and-prompt.
 *
 * Takes a DOM element descriptor picked from a RUNNING app and ranks the
 * repository locations most likely to render it. Pure lexical scoring over
 * the repo scan (no model call): ids and data-attributes are strong signals,
 * class names and visible text are medium, tag names alone are noise.
 */
import path from "node:path";
import fs from "node:fs/promises";
import { scanRepo } from "./repo-intel.mjs";

const TEXT_EXT = new Set([
  ".js", ".jsx", ".ts", ".tsx", ".mjs", ".cjs", ".vue", ".svelte",
  ".html", ".htm", ".css", ".scss", ".less", ".py", ".rb", ".php",
  ".erb", ".ejs", ".hbs", ".pug", ".go", ".rs", ".templ",
]);

function escapeRe(s) {
  return String(s).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Signals extracted from a descriptor: [{re, weight, label}] */
export function descriptorSignals(el = {}) {
  const signals = [];
  const id = String(el.id || "").trim();
  if (id) {
    signals.push({
      re: new RegExp(`(?:id\\s*[=:]\\s*["'\`]${escapeRe(id)}["'\`]|getElementById\\(\\s*["'\`]${escapeRe(id)}["'\`]|#${escapeRe(id)}\\b)`),
      weight: 40,
      label: `id:${id}`,
    });
  }
  for (const cls of (el.classes || []).slice(0, 8)) {
    const c = String(cls).trim();
    // generic 3-char utility classes (btn, row, col) are pure noise
    if (!c || c.length < 4) continue;
    signals.push({
      re: new RegExp(`(?:["'\`\\s.]${escapeRe(c)}["'\`\\s{.:])`),
      weight: 8,
      label: `class:${c}`,
    });
  }
  for (const [name, value] of Object.entries(el.attrs || {})) {
    const v = String(value || "").trim();
    if (!v || v.length < 2) continue;
    signals.push({
      re: new RegExp(`${escapeRe(name)}\\s*[=:]\\s*["'\`]${escapeRe(v.slice(0, 60))}`),
      weight: name.startsWith("data-") ? 20 : 10,
      label: `${name}=${v.slice(0, 30)}`,
    });
  }
  const text = String(el.text || "").trim();
  if (text.length >= 4 && text.length <= 80 && !/\n/.test(text)) {
    signals.push({
      re: new RegExp(escapeRe(text)),
      weight: 25,
      label: `text:"${text.slice(0, 40)}"`,
    });
  }
  return signals;
}

/**
 * @param {string} repoDir
 * @param {object} element — {id?, classes?[], attrs?{}, text?, tag?, selector?}
 * @returns {Promise<{matches: Array<{file,line,score,matchedOn,snippet}>, signals: string[]}>}
 */
export async function resolveElementSource(repoDir, element, { limit = 8 } = {}) {
  const signals = descriptorSignals(element);
  if (!signals.length) return { matches: [], signals: [] };
  const files = await scanRepo(repoDir);
  const matches = [];
  for (const f of files) {
    if (!TEXT_EXT.has(f.ext)) continue;
    let content;
    try {
      content = await fs.readFile(path.join(repoDir, f.path), "utf8");
    } catch {
      continue;
    }
    let score = 0;
    let line = null;
    const matchedOn = [];
    for (const sig of signals) {
      const m = sig.re.exec(content);
      if (!m) continue;
      score += sig.weight;
      matchedOn.push(sig.label);
      const l = content.slice(0, m.index).split("\n").length;
      if (line === null || sig.weight >= 20) line = line === null ? l : sig.weight >= 20 ? l : line;
    }
    if (!score) continue;
    // markup/style files that *define* UI outrank incidental mentions
    if ([".html", ".htm", ".jsx", ".tsx", ".vue", ".svelte"].includes(f.ext)) score += 5;
    const snippetLine = line || 1;
    const lines = content.split("\n");
    const snippet = lines
      .slice(Math.max(0, snippetLine - 2), snippetLine + 2)
      .join("\n")
      .slice(0, 300);
    matches.push({ file: f.path, line: snippetLine, score, matchedOn, snippet });
  }
  matches.sort((a, b) => b.score - a.score);
  return { matches: matches.slice(0, limit), signals: signals.map((s) => s.label) };
}

/** One-shot element picker script, injected into the target page via CDP. */
export const PICKER_JS = `(() => {
  if (window.__xclawPickActive) return "already-armed";
  window.__xclawPickActive = true;
  window.__xclawPick = null;
  const ov = document.createElement("div");
  ov.style.cssText = "position:fixed;z-index:2147483647;pointer-events:none;border:2px solid #ff5470;background:rgba(255,84,112,.15);border-radius:4px;transition:all .04s;left:-9999px;top:-9999px";
  const tip = document.createElement("div");
  tip.style.cssText = "position:fixed;z-index:2147483647;pointer-events:none;background:#1c1030;color:#fff;font:12px/1.6 system-ui;padding:2px 8px;border-radius:4px;left:-9999px;top:-9999px";
  tip.textContent = "click an element to point at it (Esc cancels)";
  document.documentElement.appendChild(ov);
  document.documentElement.appendChild(tip);
  const disarm = () => {
    document.removeEventListener("mousemove", move, true);
    document.removeEventListener("click", click, true);
    document.removeEventListener("keydown", key, true);
    ov.remove(); tip.remove();
    window.__xclawPickActive = false;
  };
  const move = (e) => {
    const t = e.target;
    if (!t || t === ov || t === tip) return;
    const r = t.getBoundingClientRect();
    Object.assign(ov.style, { left: r.left + "px", top: r.top + "px", width: r.width + "px", height: r.height + "px" });
    Object.assign(tip.style, { left: Math.min(r.left, innerWidth - 260) + "px", top: Math.max(0, r.top - 24) + "px" });
  };
  const key = (e) => { if (e.key === "Escape") { window.__xclawPick = { cancelled: true }; disarm(); } };
  const click = (e) => {
    e.preventDefault(); e.stopPropagation();
    const t = e.target;
    window.__xclawPick = {
      tag: (t.tagName || "").toLowerCase(),
      id: t.id || null,
      classes: [...(t.classList || [])].slice(0, 10),
      text: (t.textContent || "").trim().slice(0, 120),
      attrs: Object.fromEntries([...(t.attributes || [])]
        .filter((a) => a.name.startsWith("data-") || ["name","type","placeholder","aria-label","title","href","src","alt"].includes(a.name))
        .map((a) => [a.name, String(a.value).slice(0, 120)])),
      selector: t.id ? "#" + t.id : (t.tagName || "").toLowerCase() + ([...(t.classList || [])].length ? "." + [...(t.classList || [])].slice(0, 4).join(".") : ""),
      html: (t.outerHTML || "").slice(0, 400),
      url: location.href,
    };
    disarm();
  };
  document.addEventListener("mousemove", move, true);
  document.addEventListener("click", click, true);
  document.addEventListener("keydown", key, true);
  return "armed";
})()`;
