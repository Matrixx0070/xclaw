/**
 * Horizon 1 — Fusion Sense
 *
 * First principles:
 * - Observation is three channels: structure (a11y/DOM), network (truth), pixels (fallback)
 * - Every consequential action gets an actionId bound to network flows
 * - Outcome assertions check the truth channel, not model vibes
 *
 * Structure-first, vision-second. Network is causal ground truth when MITM is on.
 */

import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { isMitmEnabled, readMitmFlows, mitmConfdir } from "./mitm.mjs";

/** @type {Map<string, { ts: number, label?: string, tabId?: string }>} */
const actionRegistry = new Map();

/** Max retained action bindings in memory */
const MAX_ACTIONS = 500;

/**
 * Mint a causal action id (short, unique, sortable-ish).
 */
export function createActionId(label = "") {
  const id = `act_${Date.now().toString(36)}_${crypto.randomBytes(3).toString("hex")}`;
  actionRegistry.set(id, { ts: Date.now() / 1000, label: label || undefined });
  if (actionRegistry.size > MAX_ACTIONS) {
    const first = actionRegistry.keys().next().value;
    actionRegistry.delete(first);
  }
  return id;
}

export function getActionMeta(actionId) {
  return actionRegistry.get(actionId) || null;
}

/**
 * Cursor for network delta: timestamp (seconds) + optional flow count hint.
 */
export function networkCursor() {
  return {
    ts: Date.now() / 1000,
    mitm: isMitmEnabled(),
  };
}

/**
 * Flows that occurred after cursor.ts (and match optional host filter).
 */
export async function networkDeltaSince(cursor, opts = {}) {
  if (!cursor || !isMitmEnabled()) {
    return { enabled: false, flows: [], count: 0 };
  }
  const sinceTs = Number(cursor.ts) || 0;
  const flows = await readMitmFlows(null, {
    limit: opts.limit || 100,
    host: opts.host,
    method: opts.method,
    sinceTs,
  });
  // readMitmFlows may not filter sinceTs — filter here
  const filtered = flows.filter((f) => {
    const t = Number(f.ts) || 0;
    return t >= sinceTs - 0.05; // small skew tolerance
  });
  return {
    enabled: true,
    sinceTs,
    count: filtered.length,
    flows: filtered,
  };
}

/**
 * Bind actionId → flows (in memory + optional disk append).
 */
export async function bindActionFlows(actionId, flows, extra = {}) {
  const rec = {
    actionId,
    ts: Date.now() / 1000,
    label: extra.label,
    tabId: extra.tabId,
    flowCount: (flows || []).length,
    flows: (flows || []).slice(0, 50).map(compactFlow),
  };
  const meta = actionRegistry.get(actionId);
  if (meta) {
    meta.bound = rec;
  }
  try {
    const confdir = mitmConfdir();
    await fs.mkdir(confdir, { recursive: true });
    const line = JSON.stringify(rec) + "\n";
    await fs.appendFile(path.join(confdir, "action-bindings.jsonl"), line);
  } catch {
    /* disk optional */
  }
  return rec;
}

function compactFlow(f) {
  return {
    ts: f.ts,
    method: f.method,
    host: f.host,
    path: f.path,
    status: f.status,
    url: typeof f.url === "string" ? f.url.slice(0, 200) : f.url,
    kind: f.kind,
  };
}

/**
 * Wrap a browser tool execute: open network cursor → run → attach delta + actionId.
 */
export function withNetworkBinding(executeFn, { label } = {}) {
  return async function boundExecute(args = {}, ...rest) {
    const actionId = createActionId(label || "browser");
    const cursor = networkCursor();
    let result;
    try {
      result = await executeFn(args, ...rest);
    } catch (e) {
      const delta = await networkDeltaSince(cursor);
      await bindActionFlows(actionId, delta.flows, { label, error: true });
      throw e;
    }
    const delta = await networkDeltaSince(cursor);
    await bindActionFlows(actionId, delta.flows, {
      label,
      tabId: args.tabId,
    });

    if (!result || typeof result !== "object") {
      return result;
    }
    const meta = {
      ...(result.metadata || {}),
      actionId,
      network: {
        enabled: delta.enabled,
        flowCount: delta.count,
        sinceTs: cursor.ts,
        flows: delta.flows.slice(0, 20).map(compactFlow),
      },
    };
    // Annotate text content with a short sense footer when MITM saw traffic
    if (delta.enabled && delta.count > 0 && Array.isArray(result.content)) {
      const footer = `\n\n[sense] actionId=${actionId} network_delta=${delta.count} flow(s)`;
      const texts = result.content.filter((c) => c.type === "text");
      if (texts.length) {
        texts[texts.length - 1].text = String(texts[texts.length - 1].text || "") + footer;
      }
    }
    return { ...result, metadata: meta };
  };
}

/**
 * Compact a11y-ish tree from a list of nodes (CDP AXNode or DOM-role walk).
 * @param {Array<object>} nodes
 * @param {object} [opts]
 */
export function formatA11ySnapshot(nodes, opts = {}) {
  const max = opts.maxNodes || 120;
  const lines = [];
  const list = Array.isArray(nodes) ? nodes.slice(0, max) : [];
  for (const n of list) {
    if (n.ignored) continue;
    const role = n.role?.value || n.role || n.tag || "?";
    const name = n.name?.value || n.name || n.label || "";
    const val = n.value?.value || n.value || "";
    const depth = Number(n.depth) || 0;
    const pad = "  ".repeat(Math.min(depth, 8));
    const focus = n.focusable || n.focused ? "*" : " ";
    const mark = n.mark != null ? `@${n.mark} ` : "";
    let line = `${pad}${mark}${focus}[${role}]`;
    if (name) line += ` ${String(name).slice(0, 80)}`;
    if (val) line += ` = ${String(val).slice(0, 40)}`;
    if (n.bbox && (n.bbox.cx != null)) line += ` (${n.bbox.cx},${n.bbox.cy})`;
    if (n.backendDOMNodeId) line += ` #${n.backendDOMNodeId}`;
    lines.push(line);
  }
  return lines.join("\n");
}

/**
 * Page-side JS for structure-first snapshot (runs in browser via computer).
 * Collects landmarks, headings, links, buttons, inputs — a11y-oriented DOM.
 */
export const STRUCTURE_SNAPSHOT_JS = `
(() => {
  const max = 150;
  const nodes = [];
  const push = (el, depth, role) => {
    if (nodes.length >= max) return;
    const tag = (el.tagName || "").toLowerCase();
    const name = (
      el.getAttribute("aria-label") ||
      el.getAttribute("alt") ||
      el.getAttribute("title") ||
      el.getAttribute("placeholder") ||
      (el.innerText || "").trim().slice(0, 80) ||
      el.getAttribute("name") ||
      ""
    );
    const value = el.value != null ? String(el.value).slice(0, 60) : "";
    let bbox = null;
    try {
      const r = el.getBoundingClientRect();
      if (r && (r.width > 0 || r.height > 0)) {
        bbox = {
          x: Math.round(r.x),
          y: Math.round(r.y),
          w: Math.round(r.width),
          h: Math.round(r.height),
          cx: Math.round(r.x + r.width / 2),
          cy: Math.round(r.y + r.height / 2),
        };
      }
    } catch (_) {}
    const mark = nodes.length + 1;
    nodes.push({
      mark,
      tag,
      role: role || el.getAttribute("role") || tag,
      name,
      value,
      depth,
      focusable: typeof el.tabIndex === "number" && el.tabIndex >= 0,
      href: el.href || undefined,
      type: el.type || undefined,
      bbox,
    });
  };
  const interesting = "a,button,input,select,textarea,summary,[role],[contenteditable],h1,h2,h3,h4,nav,main,header,footer,form,label";
  const all = document.querySelectorAll(interesting);
  for (const el of all) {
    if (nodes.length >= max) break;
    // skip invisible
    try {
      const st = window.getComputedStyle(el);
      if (st && (st.visibility === "hidden" || st.display === "none")) continue;
    } catch (_) {}
    let depth = 0;
    let p = el.parentElement;
    while (p && depth < 12) { depth++; p = p.parentElement; }
    push(el, Math.min(depth, 8), el.getAttribute("role"));
  }
  return {
    channel: "structure",
    title: document.title || "",
    url: location.href || "",
    readyState: document.readyState,
    viewport: { w: window.innerWidth, h: window.innerHeight, dpr: window.devicePixelRatio || 1 },
    nodeCount: nodes.length,
    nodes,
  };
})()
`.trim();


/**
 * Outcome assertion against network delta.
 * @param {object} expect
 * @param {string} [expect.host]
 * @param {string} [expect.method]
 * @param {string} [expect.pathContains]
 * @param {number|number[]} [expect.status]  e.g. 200 or [200,201]
 * @param {number} [expect.minFlows]
 * @param {Array} flows
 */
export function assertOutcome(expect = {}, flows = []) {
  const failures = [];
  const list = Array.isArray(flows) ? flows : [];

  if (expect.minFlows != null && list.length < Number(expect.minFlows)) {
    failures.push(`minFlows: got ${list.length}, want >= ${expect.minFlows}`);
  }

  let matched = list;
  if (expect.host) {
    const h = String(expect.host).toLowerCase();
    matched = matched.filter((f) => String(f.host || "").toLowerCase().includes(h));
    if (!matched.length) failures.push(`host matching "${expect.host}" not found`);
  }
  if (expect.method) {
    const m = String(expect.method).toUpperCase();
    matched = matched.filter((f) => String(f.method || "").toUpperCase() === m);
    if (!matched.length) failures.push(`method ${m} not found`);
  }
  if (expect.pathContains) {
    const p = String(expect.pathContains);
    matched = matched.filter(
      (f) => String(f.path || "").includes(p) || String(f.url || "").includes(p)
    );
    if (!matched.length) failures.push(`pathContains "${p}" not found`);
  }
  if (expect.status != null) {
    const want = Array.isArray(expect.status) ? expect.status : [expect.status];
    matched = matched.filter((f) => want.includes(Number(f.status)));
    if (!matched.length) failures.push(`status in [${want.join(",")}] not found`);
  }

  return {
    ok: failures.length === 0,
    failures,
    matchedCount: matched.length,
    totalFlows: list.length,
    matched: matched.slice(0, 10).map(compactFlow),
  };
}

/**
 * Load recent action bindings from disk.
 */
export async function readActionBindings(opts = {}) {
  const limit = opts.limit || 50;
  try {
    const p = path.join(mitmConfdir(), "action-bindings.jsonl");
    const raw = await fs.readFile(p, "utf8");
    const lines = raw.trim().split("\n").filter(Boolean);
    return lines
      .slice(-limit)
      .map((l) => {
        try {
          return JSON.parse(l);
        } catch {
          return null;
        }
      })
      .filter(Boolean)
      .reverse();
  } catch {
    return [];
  }
}

export default {
  createActionId,
  networkCursor,
  networkDeltaSince,
  bindActionFlows,
  withNetworkBinding,
  formatA11ySnapshot,
  STRUCTURE_SNAPSHOT_JS,
  assertOutcome,
  readActionBindings,
};
