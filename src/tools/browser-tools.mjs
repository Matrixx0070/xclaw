import {
  setMarksFromStructure,
  resolveMark,
  clearMarkCache,
} from "../browser/mark-cache.mjs";
import {
  createActionId,
  networkCursor,
  networkDeltaSince,
  bindActionFlows,
  formatA11ySnapshot,
  STRUCTURE_SNAPSHOT_JS,
  readActionBindings,
  assertOutcome,
} from "../browser/sense.mjs";
/**
 * Browser screenshot + snapshot tools — drive computer xclaw_browser_tab.
 */
import fs from "node:fs/promises";
import path from "node:path";
import crypto from "node:crypto";
import {
  isMitmEnabled,
  mitmStatus,
  readMitmFlows,
  clearMitmFlows,
  formatMitmFlows,
  startMitm,
  stopMitm,
  mitmCaStatus,
  ensureMitmCa,
  exportMitmCa,
  trustMitmCaInProfile,
} from "../browser/mitm.mjs";
import {
  loadPolicy,
  savePolicy,
  evaluateRequestPolicy,
  exportProofBundle,
} from "../browser/truth.mjs";
import {
  loadTimeline,
  scoreCausal,
  timeTravelReport,
} from "../browser/timetravel.mjs";
import {
  listTabLeases,
  releaseTabLease,
  requireTabLease,
  listCommitGates,
  openCommitGate,
  resolveCommitGate,
  requireCommitGate,
  fabricStatus,
} from "../browser/physics.mjs";
import {
  acquireWithHeartbeat,
  touchLease,
  startLeaseHeartbeat,
  stopLeaseHeartbeat,
  listLeaseHeartbeats,
} from "../browser/lease-heartbeat.mjs";
import {
  bindRole,
  getBoundRole,
  resolveRole,
} from "../browser/role-binding.mjs";

function textResult(text, extra = {}) {
  return { content: [{ type: "text", text: String(text ?? "") }], ...extra };
}
function errorResult(msg) {
  return { isError: true, content: [{ type: "text", text: String(msg) }] };
}

const SCREENSHOT_MIN_BYTES = 100;

async function screenshotFileLanded(dest, minBytes = SCREENSHOT_MIN_BYTES) {
  try {
    const buf = await fs.readFile(dest);
    return buf.length >= minBytes;
  } catch {
    return false;
  }
}

function resolveSid(sessionId) {
  return typeof sessionId === "function" ? sessionId() : sessionId;
}

function tabCall(ctx, args) {
  return import("../agent/computer-client.mjs").then((m) =>
    m.callToolRecovering(ctx.computer, ctx.sessionId, "xclaw_browser_tab", args, {
      workingDir: ctx.workingDir,
      setSessionId: ctx.setSessionId,
    })
  );
}

/**
 * @param {{ computer, sessionId, workingDir }} ctx
 */
export function createBrowserScreenshotTool(ctx = {}) {
  return {
    name: "browser_screenshot",
    description:
      "Capture a screenshot of the current (or new) browser tab. Saves PNG under artifacts/screenshots/.",
    parameters: {
      type: "object",
      properties: {
        url: { type: "string", description: "Optional URL to open first" },
        tabId: { type: "string" },
        full_page: { type: "boolean" },
      },
    },
    async execute(args = {}) {
      const { computer, sessionId, workingDir } = ctx;
      if (!computer || !sessionId) {
        return errorResult("Computer session required (start gateway/agent with computer)");
      }
      const outDir = path.join(workingDir || process.cwd(), "artifacts", "screenshots");
      await fs.mkdir(outDir, { recursive: true });
      const id = crypto.randomBytes(4).toString("hex");
      const dest = path.join(outDir, `shot_${id}.png`);

      // Prefer built-in screenshot param on browser_tab if supported
      const callArgs = {
        tabId: args.tabId,
        url: args.url,
        screenshot: "desktop",
        waitTime: args.url ? 2 : 0.5,
      };
      // JS fallback: use CDP-ish canvas or document serialization notice
      if (args.full_page) {
        callArgs.jsCode = `
          const html = document.documentElement.outerHTML.slice(0, 500);
          return { title: document.title, url: location.href, hint: 'full_page', htmlLen: document.documentElement.outerHTML.length };
        `;
      }
      try {
        const result = await tabCall(ctx, callArgs);
        // Persist any image metadata / base64 if present
        const content = result?.content || [];
        let saved = null;
        for (const c of content) {
          if (c.type === "image" && c.data) {
            const buf = Buffer.from(c.data, "base64");
            if (buf.length >= SCREENSHOT_MIN_BYTES) {
              await fs.writeFile(dest, buf);
              if (await screenshotFileLanded(dest)) saved = dest;
            }
          }
          if (!saved && c.type === "text" && c.text) {
            // try extract data URL
            const m = String(c.text).match(/data:image\/png;base64,([A-Za-z0-9+/=]+)/);
            if (m) {
              const buf = Buffer.from(m[1], "base64");
              if (buf.length >= SCREENSHOT_MIN_BYTES) {
                await fs.writeFile(dest, buf);
                if (await screenshotFileLanded(dest)) saved = dest;
              }
            }
          }
        }
        // Computer may have written the file itself — only trust a real PNG
        if (!saved && result?.metadata?.screenshotPath) {
          if (await screenshotFileLanded(result.metadata.screenshotPath)) {
            saved = result.metadata.screenshotPath;
          }
        }
        if (!saved) {
          // Diagnostic for the model, but this is not a screenshot
          const diag = path.join(outDir, `shot_${id}.json`);
          await fs.writeFile(diag, JSON.stringify(result, null, 2).slice(0, 50_000));
          return errorResult(
            `Screenshot API returned no image bytes. Diagnostic: ${diag}\nUse xclaw_browser_tab with screenshot:"desktop" or check computer server vision flags.`
          );
        }
        return textResult(`Screenshot saved: ${saved}`, { metadata: { path: saved } });
      } catch (e) {
        return errorResult(e.message || String(e));
      }
    },
  };
}

export function createBrowserSnapshotTool(ctx = {}) {
  return {
    name: "browser_snapshot",
    description:
      "Structure-first page observation (Horizon 1): interactive a11y-oriented tree (roles, names, values), title, url. Prefer this over screenshots. Attaches network delta when MITM is on.",
    parameters: {
      type: "object",
      properties: {
        url: { type: "string", description: "Optional URL to open first" },
        tabId: { type: "string" },
        max_nodes: { type: "number", description: "Max interactive nodes (default 150)" },
      },
    },
    async execute(args = {}) {
      const { computer, sessionId } = ctx;
      if (!computer || !sessionId) {
        return errorResult("Computer session required");
      }
      const actionId = createActionId("browser_snapshot");
      const cursor = networkCursor(ctx.cfg || null);
      try {
        const result = await tabCall(ctx, {
          tabId: args.tabId,
          url: args.url,
          waitTime: args.url ? 1.5 : 0.3,
          jsCode: STRUCTURE_SNAPSHOT_JS,
        });
        const delta = await networkDeltaSince(cursor, { cfg: ctx.cfg || null });
        await bindActionFlows(actionId, delta.flows, {
          cfg: ctx.cfg || null,
          label: "browser_snapshot",
          tabId: args.tabId,
        });

        // Parse structure from tool text if possible
        let structure = null;
        const textParts = (result?.content || [])
          .filter((x) => x.type === "text")
          .map((x) => x.text)
          .join("\n");
        try {
          // computer may wrap JS return as JSON in text
          const m = textParts.match(/\{[\s\S]*"channel"\s*:\s*"structure"[\s\S]*\}/);
          if (m) structure = JSON.parse(m[0]);
          else {
            const m2 = textParts.match(/\{[\s\S]{20,}\}/);
            if (m2) {
              const j = JSON.parse(m2[0]);
              if (j.nodes || j.title) structure = j;
            }
          }
        } catch {
          /* keep raw */
        }

        let body;
        if (structure?.nodes) {
          const tree = formatA11ySnapshot(structure.nodes, {
            maxNodes: Number(args.max_nodes) || 150,
          });
          body = [
            `channel: structure`,
            `title: ${structure.title || ""}`,
            `url: ${structure.url || ""}`,
            `ready: ${structure.readyState || ""}`,
            `nodes: ${structure.nodeCount ?? structure.nodes.length}`,
            `actionId: ${actionId}`,
            "",
            tree || "(no interactive nodes)",
          ].join("\n");
        } else {
          body = [
            `channel: structure (raw)`,
            `actionId: ${actionId}`,
            textParts.slice(0, 12_000),
          ].join("\n");
        }

        if (delta.enabled) {
          body += `\n\n[sense] network_delta=${delta.count}`;
          if (delta.count) {
            body +=
              "\n" +
              delta.flows
                .slice(0, 8)
                .map((f) => `  ${f.method || "?"} ${f.status || ""} ${f.host || ""}${(f.path || "").slice(0, 60)}`)
                .join("\n");
          }
        }

        let markMeta = null;
        if (structure?.nodes) {
          markMeta = setMarksFromStructure(resolveSid(sessionId), structure, { tabId: args.tabId });
        } else {
          // soft: parse failed / no nodes — do not poison coordinates
          markMeta = { ok: false, code: "STRUCTURE_PARSE_FAILED" };
        }

        return textResult(body, {
          metadata: {
            source: "browser_snapshot",
            channel: "structure",
            actionId,
            network: {
              enabled: delta.enabled,
              flowCount: delta.count,
              flows: delta.flows.slice(0, 15),
            },
            structure: structure
              ? { title: structure.title, url: structure.url, nodeCount: structure.nodeCount }
              : null,
            marks: markMeta,
          },
        });
      } catch (e) {
        return errorResult(e?.message || String(e));
      }
    },
  };
}

export function createBrowserClipboardTool(ctx = {}) {
  return {
    name: "browser_clipboard",
    description: "Read or write the browser page clipboard via document/execCommand or navigator.clipboard (best-effort).",
    parameters: {
      type: "object",
      properties: {
        action: { type: "string", description: "read | write" },
        text: { type: "string", description: "Text to write when action=write" },
        tabId: { type: "string" },
      },
      required: ["action"],
    },
    async execute(args = {}) {
      const { computer, sessionId } = ctx;
      if (!computer || !sessionId) return errorResult("Computer session required");
      const action = String(args.action || "read").toLowerCase();
      const jsCode =
        action === "write"
          ? `
            const t = ${JSON.stringify(String(args.text || ""))};
            try {
              await navigator.clipboard.writeText(t);
              return { ok: true, action: "write", len: t.length };
            } catch (e) {
              return { ok: false, error: String(e) };
            }
          `
          : `
            try {
              const t = await navigator.clipboard.readText();
              return { ok: true, action: "read", text: t.slice(0, 20000) };
            } catch (e) {
              return { ok: false, error: String(e) };
            }
          `;
      try {
        const result = await tabCall(ctx, {
          tabId: args.tabId,
          jsCode,
          waitTime: 0.2,
        });
        const texts = (result?.content || []).filter((c) => c.type === "text").map((c) => c.text);
        return textResult(texts.join("\\n") || JSON.stringify(result).slice(0, 8000));
      } catch (e) {
        return errorResult(e.message);
      }
    },
  };
}

export function createBrowserPdfTool(ctx = {}) {
  return {
    name: "browser_pdf",
    description: "Print the current page to PDF via browser CDP/print (best-effort) or return HTML snapshot for office_convert.",
    parameters: {
      type: "object",
      properties: {
        url: { type: "string" },
        tabId: { type: "string" },
        out: { type: "string" },
      },
    },
    async execute(args = {}) {
      const { computer, sessionId, workingDir } = ctx;
      if (!computer || !sessionId) return errorResult("Computer session required");
      const path = await import("node:path");
      const fs = await import("node:fs/promises");
      const crypto = await import("node:crypto");
      const outDir = path.join(workingDir || process.cwd(), "artifacts", "pdf");
      await fs.mkdir(outDir, { recursive: true });
      const dest =
        args.out ||
        path.join(outDir, `page_${crypto.randomBytes(4).toString("hex")}.pdf`);
      // Try Page.printToPDF via injected evaluation marker — computer may expose print
      const jsCode = `
        return {
          title: document.title,
          url: location.href,
          htmlLength: document.documentElement.outerHTML.length,
          hint: "Use office_convert on saved HTML if PDF binary not returned by computer server"
        };
      `;
      try {
        const result = await tabCall(ctx, {
          tabId: args.tabId,
          url: args.url,
          jsCode,
          waitTime: args.url ? 2 : 0.5,
          // some servers accept printPdf
          printPdf: true,
        });
        // Save HTML fallback
        const texts = (result?.content || []).filter((c) => c.type === "text").map((c) => c.text);
        const htmlPath = dest.replace(/\\.pdf$/, ".html");
        // fetch page html
        const htmlRes = await tabCall(ctx, {
          tabId: args.tabId,
          jsCode: `return document.documentElement.outerHTML.slice(0, 500000);`,
          waitTime: 0.2,
        });
        const htmlTexts = (htmlRes?.content || []).filter((c) => c.type === "text").map((c) => c.text);
        if (htmlTexts[0] && htmlTexts[0].includes("<")) {
          await fs.writeFile(htmlPath, htmlTexts[0]);
          return textResult(
            `Saved HTML snapshot: ${htmlPath}\\nConvert with office_convert format=pdf if needed.\\n${texts.join("\\n").slice(0, 500)}`,
            { metadata: { htmlPath, requestedPdf: dest } }
          );
        }
        return textResult(texts.join("\\n") || JSON.stringify(result).slice(0, 4000), {
          metadata: { requestedPdf: dest },
        });
      } catch (e) {
        return errorResult(e.message);
      }
    },
  };
}

/**
 * M3 — MITM status / flow inspection tools (always registered; gate inside execute).
 */
export function createMitmStatusTool(ctx = {}) {
  return {
    name: "mitm_status",
    description:
      "Report XClaw MITM proxy status: enabled, running, port, CA present, flow count. MITM is opt-in via XCLAW_MITM=true.",
    parameters: { type: "object", properties: {} },
    async execute() {
      const st = await mitmStatus(ctx.cfg || null);
      const lines = [
        `enabled: ${st.enabled}`,
        `running: ${st.running}`,
        `listening: ${st.listening}`,
        `ready: ${st.ready}`,
        `pid: ${st.pid ?? "—"}`,
        `port: ${st.port}`,
        `proxyUrl: ${st.proxyUrl ?? "—"}`,
        `confdir: ${st.confdir}`,
        `caPresent: ${st.caPresent}`,
        `caPath: ${st.caPath ?? "—"}`,
        `mitmdump: ${st.mitmdump ?? "not found"}`,
        `flowCount: ${st.flowCount}`,
        `blocked: ${st.blocked ?? 0}`,
        `errors: ${st.errors ?? 0}`,
        `tlsFailClient: ${st.tlsFailClient ?? 0}`,
        `tlsFailServer: ${st.tlsFailServer ?? 0}`,
        `lastFlowTs: ${st.lastFlowTs ?? "—"}`,
        `flowsPath: ${st.flowsPath}`,
      ];
      return textResult(lines.join("\n"), { metadata: st });
    },
  };
}

export function createMitmFlowsTool(ctx = {}) {
  return {
    name: "mitm_flows",
    description:
      "List recent redacted HTTP flows captured by XClaw MITM (from flows.jsonl). Filter by host, method, status, url substring. Requires XCLAW_MITM and prior browser traffic through the proxy.",
    parameters: {
      type: "object",
      properties: {
        limit: { type: "number", description: "Max flows to return (default 40, max 200)" },
        host: { type: "string", description: "Filter host (substring / suffix match)" },
        method: { type: "string", description: "HTTP method e.g. GET POST" },
        status: { type: "number", description: "Exact status code" },
        statusMin: { type: "number" },
        statusMax: { type: "number" },
        urlContains: { type: "string", description: "Substring match on URL" },
        sinceTs: { type: "number", description: "Unix epoch seconds — only flows after this" },
      },
    },
    async execute(args = {}) {
      if (!isMitmEnabled(ctx.cfg || null)) {
        return textResult(
          "MITM is disabled. Enable with XCLAW_MITM=true (or browser.mitm.enabled) and restart supervisor.",
          { metadata: { enabled: false } }
        );
      }
      const limit = Math.min(200, Math.max(1, Number(args.limit) || 40));
      const flows = await readMitmFlows(ctx.cfg || null, {
        limit,
        host: args.host,
        method: args.method,
        status: args.status,
        statusMin: args.statusMin,
        statusMax: args.statusMax,
        urlContains: args.urlContains,
        sinceTs: args.sinceTs,
      });
      const text = formatMitmFlows(flows, { max: limit });
      return textResult(
        `MITM flows (${flows.length}):\n${text}`,
        { metadata: { count: flows.length, flows } }
      );
    },
  };
}

export function createMitmClearFlowsTool(ctx = {}) {
  return {
    name: "mitm_clear_flows",
    description: "Clear the MITM flows.jsonl log (redacted traffic history).",
    parameters: { type: "object", properties: {} },
    async execute() {
      if (!isMitmEnabled(ctx.cfg || null)) {
        return textResult("MITM disabled — nothing to clear.", { metadata: { enabled: false } });
      }
      const r = await clearMitmFlows(ctx.cfg || null);
      if (!r.ok) return errorResult(r.error || "clear failed");
      return textResult(`Cleared ${r.path}`, { metadata: r });
    },
  };
}

export function createMitmControlTool(ctx = {}) {
  return {
    name: "mitm_control",
    description:
      "Start or stop the MITM mitmdump sidecar (opt-in). action: start | stop | status.",
    parameters: {
      type: "object",
      properties: {
        action: {
          type: "string",
          description: "start | stop | status",
          enum: ["start", "stop", "status"],
        },
      },
      required: ["action"],
    },
    async execute(args = {}) {
      const action = String(args.action || "status").toLowerCase();
      if (action === "status") {
        const st = await mitmStatus(ctx.cfg || null);
        return textResult(JSON.stringify(st, null, 2), { metadata: st });
      }
      if (action === "start") {
        if (!isMitmEnabled(ctx.cfg || null)) {
          return errorResult("MITM disabled — set XCLAW_MITM=true first");
        }
        const r = await startMitm(ctx.cfg || null);
        return textResult(JSON.stringify(r, null, 2), { metadata: r, isError: !r.ok });
      }
      if (action === "stop") {
        const r = await stopMitm(ctx.cfg || null);
        return textResult(JSON.stringify(r, null, 2), { metadata: r });
      }
      return errorResult(`Unknown action: ${action}`);
    },
  };
}

export function createMitmCaTool(ctx = {}) {
  return {
    name: "mitm_ca",
    description:
      "Manage mitmproxy CA certificate: status (subject/dates/SPKI), ensure (generate if missing), export PEM/P12/SPKI, or trust into a Chromium profile dir via certutil.",
    parameters: {
      type: "object",
      properties: {
        action: {
          type: "string",
          enum: ["status", "ensure", "export", "trust"],
          description: "status | ensure | export | trust",
        },
        dest: {
          type: "string",
          description: "For export: directory or .pem path. For trust: Chromium user-data-dir",
        },
      },
      required: ["action"],
    },
    async execute(args = {}) {
      const action = String(args.action || "status").toLowerCase();
      const cfg = ctx.cfg || null;
      if (action === "status") {
        const st = await mitmCaStatus(cfg);
        return textResult(JSON.stringify(st, null, 2), { metadata: st });
      }
      if (action === "ensure") {
        const r = await ensureMitmCa(cfg);
        return textResult(JSON.stringify(r, null, 2), { metadata: r, isError: !r.ok });
      }
      if (action === "export") {
        const r = await exportMitmCa(cfg, args.dest || null);
        if (!r.ok) return errorResult(r.reason || "export failed");
        return textResult(
          `Exported CA to ${r.certPath}` + (r.spki ? `\nSPKI: ${r.spki}\nChrome: ${r.chromeFlag}` : ""),
          { metadata: r }
        );
      }
      if (action === "trust") {
        if (!args.dest) return errorResult("dest=Chromium user-data-dir required for trust");
        const r = await trustMitmCaInProfile(args.dest, cfg);
        return textResult(JSON.stringify(r, null, 2), { metadata: r, isError: !r.ok });
      }
      return errorResult(`Unknown action: ${action}`);
    },
  };
}


/**
 * Horizon 1 primary observe — structure + optional network status (no pixels).
 */
export function createBrowserObserveTool(ctx = {}) {
  return {
    name: "browser_observe",
    description:
      "Primary hybrid sense (Horizon 1 / P0.4): structure-first a11y tree with set-of-marks indices + click coords, network delta when MITM on, optional pixels. Prefer over screenshot-only. Set include_pixels=true for vision fallback on canvas/unknown widgets.",
    parameters: {
      type: "object",
      properties: {
        url: { type: "string" },
        tabId: { type: "string" },
        max_nodes: { type: "number", description: "Max interactive nodes (default 150)" },
        include_pixels: {
          type: "boolean",
          description: "Also capture screenshot path (default false — structure first)",
        },
      },
    },
    async execute(args = {}) {
      const snap = createBrowserSnapshotTool(ctx);
      const structureResult = await snap.execute(args);
      if (structureResult?.isError || !args.include_pixels) {
        return structureResult;
      }
      // Hybrid: append pixel channel without replacing structure
      try {
        const shot = createBrowserScreenshotTool(ctx);
        const pixelResult = await shot.execute({
          tabId: args.tabId,
          url: undefined, // already navigated by structure path if url given
        });
        const structText = (structureResult.content || [])
          .filter((c) => c.type === "text")
          .map((c) => c.text)
          .join("\n");
        const pixelText = (pixelResult.content || [])
          .filter((c) => c.type === "text")
          .map((c) => c.text)
          .join("\n");
        return textResult(
          [
            structText,
            "",
            "channel: pixels (secondary)",
            pixelText,
          ].join("\n"),
          {
            metadata: {
              ...(structureResult.metadata || {}),
              hybrid: true,
              pixels: pixelResult.metadata || null,
            },
          }
        );
      } catch (e) {
        // structure alone is still useful
        return structureResult;
      }
    },
  };
}

/**
 * Assert network outcome after an action (truth channel).
 */
export function createBrowserAssertTool(ctx = {}) {
  return {
    name: "browser_assert",
    description:
      "Assert expected network outcomes against MITM flows (Horizon 1 truth channel). e.g. host, method, pathContains, status, minFlows. Optional sinceTs or action binding window.",
    parameters: {
      type: "object",
      properties: {
        host: { type: "string" },
        method: { type: "string" },
        pathContains: { type: "string" },
        status: { type: "number" },
        minFlows: { type: "number" },
        sinceTs: { type: "number", description: "Unix seconds; default last 60s" },
        actionId: { type: "string", description: "If set, use flows bound to this action" },
      },
    },
    async execute(args = {}) {
      if (!isMitmEnabled(ctx.cfg || null)) {
        return textResult(
          JSON.stringify({
            ok: false,
            skipped: true,
            reason: "MITM disabled — enable XCLAW_MITM for truth-channel assertions",
          }),
          { metadata: { skipped: true } }
        );
      }
      let flows = [];
      if (args.actionId) {
        const bindings = await readActionBindings({ cfg: ctx.cfg || null, limit: 100 });
        const hit = bindings.find((b) => b.actionId === args.actionId);
        flows = hit?.flows || [];
      } else {
        const sinceTs = Number(args.sinceTs) || Date.now() / 1000 - 60;
        const delta = await networkDeltaSince({ ts: sinceTs }, { cfg: ctx.cfg || null });
        flows = delta.flows;
      }
      const verdict = assertOutcome(
        {
          host: args.host,
          method: args.method,
          pathContains: args.pathContains,
          status: args.status,
          minFlows: args.minFlows,
        },
        flows
      );
      const text = JSON.stringify(verdict, null, 2);
      return textResult(text, {
        metadata: verdict,
        isError: !verdict.ok,
      });
    },
  };
}


export function createMitmPolicyTool(ctx = {}) {
  return {
    name: "mitm_policy",
    description:
      "Horizon 2 truth policy: get | set | test. Manage confdir/policy.json rules (block, map, require). Env rules still apply.",
    parameters: {
      type: "object",
      properties: {
        action: { type: "string", enum: ["get", "set", "test"], description: "get | set | test" },
        policy: { type: "object", description: "Full policy document for set" },
        rules: { type: "array", description: "Replace rules array on set (alternative to policy)" },
        host: { type: "string", description: "For test: request host" },
        path: { type: "string", description: "For test: request path" },
        method: { type: "string", description: "For test: method" },
      },
      required: ["action"],
    },
    async execute(args = {}) {
      const cfg = ctx.cfg || null;
      const action = String(args.action || "get").toLowerCase();
      if (action === "get") {
        const p = await loadPolicy(cfg);
        return textResult(JSON.stringify(p, null, 2), { metadata: p });
      }
      if (action === "set") {
        let policy = args.policy;
        if (!policy && args.rules) policy = { version: 1, rules: args.rules };
        if (!policy || !Array.isArray(policy.rules)) {
          return errorResult("set requires policy:{rules:[...]} or rules:[]");
        }
        const r = await savePolicy(policy, cfg);
        return textResult(JSON.stringify(r, null, 2), { metadata: r });
      }
      if (action === "test") {
        const p = await loadPolicy(cfg);
        const decision = evaluateRequestPolicy(p, {
          host: args.host || "",
          path: args.path || "/",
          method: args.method || "GET",
          url: (args.host || "") + (args.path || "/"),
        });
        return textResult(JSON.stringify(decision, null, 2), { metadata: decision });
      }
      return errorResult(`Unknown action: ${action}`);
    },
  };
}

export function createMitmExportTool(ctx = {}) {
  return {
    name: "mitm_export",
    description:
      "Export a redacted truth proof bundle (flows + action bindings + policy summary + sha256) for audit/eval.",
    parameters: {
      type: "object",
      properties: {
        dest: { type: "string", description: "Optional output path" },
        limit: { type: "number" },
        sinceTs: { type: "number" },
      },
    },
    async execute(args = {}) {
      try {
        const r = await exportProofBundle({
          cfg: ctx.cfg || null,
          dest: args.dest,
          limit: args.limit,
          sinceTs: args.sinceTs,
        });
        // A truncation marker only the JSON carries is a marker nobody reads.
        const mark = (n) => (n ? " (truncated)" : "");
        return textResult(
          `Proof exported: ${r.path}\nsha256: ${r.sha256}\n` +
            `flows: ${r.flowCount}${mark(r.truncated?.flows)}\n` +
            `rules: ${r.ruleCount}\n` +
            `bindings: ${r.bindingCount}${mark(r.truncated?.bindings)}`,
          { metadata: r }
        );
      } catch (e) {
        return errorResult(e?.message || String(e));
      }
    },
  };
}


export function createTabLeaseTool(ctx = {}) {
  return {
    name: "tab_lease",
    description:
      "Horizon 4 session physics: acquire | release | list | check exclusive tab leases so swarm agents do not stomp each other.",
    parameters: {
      type: "object",
      properties: {
        action: { type: "string", enum: ["acquire", "release", "renew", "list", "check", "heartbeats"] },
        tabId: { type: "string" },
        agentId: { type: "string" },
        role: { type: "string", enum: ["observer", "actor", "critic", "planner"] },
        ttlMs: { type: "number" },
        force: { type: "boolean" },
      },
      required: ["action"],
    },
    async execute(args = {}) {
      const action = String(args.action || "list").toLowerCase();
      const agentId = args.agentId || resolveSid(ctx.sessionId) || process.env.XCLAW_AGENT_ID;
      if (action === "list") {
        const leases = await listTabLeases();
        return textResult(JSON.stringify(leases, null, 2), { metadata: { leases } });
      }
      if (action === "acquire") {
        const r = await acquireWithHeartbeat(args.tabId, {
          agentId,
          role: args.role || "actor",
          ttlMs: args.ttlMs,
        });
        return textResult(JSON.stringify(r, null, 2), { metadata: r, isError: !r.ok });
      }
      if (action === "renew") {
        const r = await touchLease(args.tabId, { agentId, ttlMs: args.ttlMs });
        if (r.ok) startLeaseHeartbeat(args.tabId, { agentId, ttlMs: args.ttlMs });
        return textResult(JSON.stringify(r, null, 2), { metadata: r, isError: !r.ok });
      }
      if (action === "release") {
        stopLeaseHeartbeat(args.tabId);
        const r = await releaseTabLease(args.tabId, { agentId, force: args.force });
        return textResult(JSON.stringify(r, null, 2), { metadata: r, isError: !r.ok });
      }
      if (action === "check") {
        const r = await requireTabLease(args.tabId, {
          agentId,
          role: args.role || "actor",
          autoAcquire: false,
        });
        return textResult(JSON.stringify(r, null, 2), { metadata: r, isError: !r.ok });
      }
      if (action === "heartbeats") {
        const list = listLeaseHeartbeats();
        return textResult(JSON.stringify(list, null, 2), { metadata: { heartbeats: list } });
      }
      return errorResult(`Unknown action: ${action}`);
    },
  };
}

export function createCommitGateTool(ctx = {}) {
  return {
    name: "commit_gate",
    description:
      "Horizon 4 commit gates for irreversible browser actions: open | approve | reject | list | check. Critic role approves; actors cannot self-approve unless force.",
    parameters: {
      type: "object",
      properties: {
        action: {
          type: "string",
          enum: ["open", "approve", "reject", "list", "check"],
        },
        gateId: { type: "string" },
        url: { type: "string" },
        tabId: { type: "string" },
        reason: { type: "string" },
        role: { type: "string" },
        agentId: { type: "string" },
        force: { type: "boolean" },
      },
      required: ["action"],
    },
    async execute(args = {}) {
      const action = String(args.action || "list").toLowerCase();
      const agentId = args.agentId || resolveSid(ctx.sessionId) || process.env.XCLAW_AGENT_ID;
      if (action === "list") {
        const gates = await listCommitGates();
        return textResult(JSON.stringify(gates, null, 2), { metadata: { gates } });
      }
      if (action === "open") {
        const r = await openCommitGate({
          url: args.url,
          tabId: args.tabId,
          reason: args.reason,
          agentId,
        });
        return textResult(JSON.stringify(r, null, 2), { metadata: r });
      }
      if (action === "approve" || action === "reject") {
        if (!args.gateId) return errorResult("gateId required");
        const r = await resolveCommitGate(args.gateId, action, {
          role: args.role || "critic",
          agentId,
          reason: args.reason,
          force: args.force,
        });
        return textResult(JSON.stringify(r, null, 2), { metadata: r, isError: !r.ok });
      }
      if (action === "check") {
        const r = await requireCommitGate(args.url || "", {
          tabId: args.tabId,
          agentId,
          forceCheck: true,
        });
        return textResult(JSON.stringify(r, null, 2), { metadata: r, isError: !r.ok });
      }
      return errorResult(`Unknown action: ${action}`);
    },
  };
}

export function createFabricStatusTool(ctx = {}) {
  return {
    name: "fabric_status",
    description: "Horizon 4 fabric snapshot: tab leases, commit gates, logical clock, roles.",
    parameters: { type: "object", properties: {} },
    async execute() {
      const st = await fabricStatus();
      return textResult(JSON.stringify(st, null, 2), { metadata: st });
    },
  };
}


export function createTraceReplayTool(ctx = {}) {
  return {
    name: "trace_replay",
    description:
      "Horizon 5 time-travel: build a replay plan from MITM flows + action bindings. Optional causal expect scoring and proof export.",
    parameters: {
      type: "object",
      properties: {
        sinceTs: { type: "number" },
        limit: { type: "number" },
        exportProof: { type: "boolean" },
        expect: { type: "object", description: "causal expect: network[], actions[], minFlows, forbidHosts" },
      },
    },
    async execute(args = {}) {
      try {
        const report = await timeTravelReport({
          sinceTs: args.sinceTs,
          limit: args.limit || 200,
          exportProof: Boolean(args.exportProof),
          expect: args.expect || {},
          includeUnboundFlows: true,
        });
        const summary = {
          events: report.timeline.eventCount,
          flows: report.timeline.flowCount,
          bindings: report.timeline.bindingCount,
          steps: report.plan.stepCount,
          causal: report.causal,
          proof: report.proof,
        };
        return textResult(JSON.stringify({ summary, plan: report.plan }, null, 2), {
          metadata: report,
          isError: report.causal && report.causal.pass === false && args.expect,
        });
      } catch (e) {
        return errorResult(e?.message || String(e));
      }
    },
  };
}

export function createTraceScoreTool(ctx = {}) {
  return {
    name: "trace_score",
    description:
      "Score causal correctness of current traces against expect.network / actions / forbidHosts (Horizon 5).",
    parameters: {
      type: "object",
      properties: {
        expect: { type: "object" },
        sinceTs: { type: "number" },
        limit: { type: "number" },
      },
      required: ["expect"],
    },
    async execute(args = {}) {
      const timeline = await loadTimeline({
        cfg: ctx.cfg || null,
        sinceTs: args.sinceTs,
        limit: args.limit || 300,
      });
      const scored = scoreCausal(args.expect || {}, timeline);
      return textResult(JSON.stringify(scored, null, 2), {
        metadata: scored,
        isError: !scored.pass,
      });
    },
  };
}


export function createBrowserClickTool(ctx = {}) {
  return {
    name: "browser_click",
    description:
      "Click at viewport (x,y) or by set-of-marks index from the last browser_observe/snapshot (mark: N → bbox center). Prefer mark after observe. Errors: MARK_CACHE_EMPTY, MARK_UNKNOWN, MARK_STALE, MARK_NOT_VISIBLE.",
    parameters: {
      type: "object",
      properties: {
        x: { type: "number" },
        y: { type: "number" },
        mark: { type: "number", description: "Set-of-marks index from last observe (@N)" },
        tabId: { type: "string" },
        fromX: { type: "number" },
        fromY: { type: "number" },
        targetWidth: { type: "number" },
        label: { type: "string" },
        clickCount: { type: "number" },
        url: { type: "string", description: "Optional URL check for MARK_STALE" },
      },
    },
    async execute(args = {}) {
      const { computer, sessionId } = ctx;
      if (!computer || !sessionId) return errorResult("Computer session required");
      let x = args.x;
      let y = args.y;
      let markMeta = null;
      if (args.mark != null && args.mark !== "") {
        const resolved = resolveMark(resolveSid(sessionId), args.mark, {
          tabId: args.tabId,
          url: args.url,
        });
        if (!resolved.ok) {
          return {
            isError: true,
            content: [{ type: "text", text: `${resolved.code}: ${resolved.message}` }],
            code: resolved.code,
            metadata: resolved,
          };
        }
        x = resolved.x;
        y = resolved.y;
        markMeta = resolved;
      }
      if (x == null || y == null || Number.isNaN(Number(x)) || Number.isNaN(Number(y))) {
        return {
          isError: true,
          content: [{ type: "text", text: "MARK_CACHE_EMPTY: provide x,y or mark after browser_observe" }],
          code: "MARK_CACHE_EMPTY",
        };
      }
      try {
        const result = await tabCall(ctx, {
          tabId: args.tabId,
          motor: {
            op: "click",
            x: Number(x),
            y: Number(y),
            fromX: args.fromX,
            fromY: args.fromY,
            targetWidth: args.targetWidth ?? markMeta?.meta?.w,
            label: args.label || (markMeta ? `@${markMeta.mark}` : undefined),
            clickCount: args.clickCount || 1,
          },
          waitTime: 0.1,
        });
        return result?.isError ? result : textResult(
          typeof result === "object" ? JSON.stringify(result).slice(0, 4000) : String(result),
          { metadata: { motor: "click", x: Number(x), y: Number(y), mark: markMeta, ...(result?.metadata || {}) } }
        );
      } catch (e) {
        return errorResult(e?.message || String(e));
      }
    },
  };
}

export function createBrowserTypeTool(ctx = {}) {
  return {
    name: "browser_type",
    description:
      "A4 humanized CDP typing. Optional mark: click that set-of-marks target first (same errors as browser_click).",
    parameters: {
      type: "object",
      properties: {
        text: { type: "string" },
        tabId: { type: "string" },
        mark: { type: "number", description: "Optional: click @mark before typing" },
      },
      required: ["text"],
    },
    async execute(args = {}) {
      const { computer, sessionId } = ctx;
      if (!computer || !sessionId) return errorResult("Computer session required");
      try {
        if (args.mark != null && args.mark !== "") {
          const resolved = resolveMark(resolveSid(sessionId), args.mark, { tabId: args.tabId });
          if (!resolved.ok) {
            return {
              isError: true,
              content: [{ type: "text", text: `${resolved.code}: ${resolved.message}` }],
              code: resolved.code,
              metadata: resolved,
            };
          }
          await tabCall(ctx, {
            tabId: args.tabId,
            motor: {
              op: "click",
              x: resolved.x,
              y: resolved.y,
              label: `@${resolved.mark}`,
              clickCount: 1,
            },
            waitTime: 0.1,
          });
        }
        const result = await tabCall(ctx, {
          tabId: args.tabId,
          motor: { op: "type", text: args.text },
          waitTime: 0.05,
        });
        return result?.isError ? result : textResult(
          typeof result === "object" ? JSON.stringify(result).slice(0, 4000) : String(result),
          { metadata: { motor: "type" } }
        );
      } catch (e) {
        return errorResult(e?.message || String(e));
      }
    },
  };
}


export function createSessionRoleTool(ctx = {}) {
  return {
    name: "session_role",
    description:
      "A7 bind/get agent role for this session (observer|actor|critic|planner). Under fabric enforce, env role is ignored unless XCLAW_ROLE_FROM_ENV=1.",
    parameters: {
      type: "object",
      properties: {
        action: { type: "string", enum: ["bind", "get", "resolve"] },
        role: { type: "string", enum: ["observer", "actor", "critic", "planner"] },
        sessionId: { type: "string" },
      },
      required: ["action"],
    },
    async execute(args = {}) {
      const sid = args.sessionId || resolveSid(ctx.sessionId) || process.env.XCLAW_SESSION_ID || process.env.XCLAW_AGENT_ID;
      if (args.action === "bind") {
        const r = await bindRole(sid, args.role, { source: "tool" });
        return textResult(JSON.stringify(r, null, 2), { metadata: r, isError: !r.ok });
      }
      if (args.action === "get") {
        const r = await getBoundRole(sid);
        return textResult(JSON.stringify({ sessionId: sid, bound: r }, null, 2));
      }
      const r = await resolveRole({ sessionId: sid, agentId: sid });
      return textResult(JSON.stringify(r, null, 2), { metadata: r });
    },
  };
}

export function createBrowserTools(ctx = {}) {
  return [
    createBrowserObserveTool(ctx),
    createBrowserSnapshotTool(ctx),
    createBrowserClickTool(ctx),
    createBrowserTypeTool(ctx),
    createBrowserScreenshotTool(ctx),
    createBrowserAssertTool(ctx),
    createBrowserClipboardTool(ctx),
    createBrowserPdfTool(ctx),
    createMitmStatusTool(ctx),
    createMitmFlowsTool(ctx),
    createMitmClearFlowsTool(ctx),
    createMitmControlTool(ctx),
    createMitmCaTool(ctx),
    createMitmPolicyTool(ctx),
    createMitmExportTool(ctx),
    createTabLeaseTool(ctx),
    createCommitGateTool(ctx),
    createFabricStatusTool(ctx),
    createSessionRoleTool(ctx),
    createTraceReplayTool(ctx),
    createTraceScoreTool(ctx),
  ];
}

