/**
 * `xclaw lsp` — Language Server Protocol front-end for the completion
 * service. Editor-agnostic (VS Code generic LSP client, neovim, helix, …):
 * zero-dep JSON-RPC over stdio with Content-Length framing.
 *
 * Scope: textDocument/completion backed by completeCode (repo-aware FIM).
 * Documents are synced whole (TextDocumentSyncKind.Full) — completions are
 * built from the LIVE buffer, exactly what the completion service wants.
 */
import { fileURLToPath } from "node:url";

// ── framing ────────────────────────────────────────────────────────────

/** Incremental Content-Length frame parser. push(chunk) → complete messages. */
export function createFrameParser() {
  let buf = Buffer.alloc(0);
  return {
    push(chunk) {
      buf = Buffer.concat([buf, Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)]);
      const out = [];
      for (;;) {
        const headerEnd = buf.indexOf("\r\n\r\n");
        if (headerEnd === -1) return out;
        const header = buf.slice(0, headerEnd).toString("utf8");
        const m = header.match(/Content-Length:\s*(\d+)/i);
        if (!m) {
          // malformed header — drop it and resync
          buf = buf.slice(headerEnd + 4);
          continue;
        }
        const len = Number(m[1]);
        const start = headerEnd + 4;
        if (buf.length < start + len) return out;
        const body = buf.slice(start, start + len).toString("utf8");
        buf = buf.slice(start + len);
        try {
          out.push(JSON.parse(body));
        } catch {
          /* skip unparseable frame */
        }
      }
    },
  };
}

export function encodeFrame(msg) {
  const body = Buffer.from(JSON.stringify(msg), "utf8");
  return Buffer.concat([Buffer.from(`Content-Length: ${body.length}\r\n\r\n`, "utf8"), body]);
}

// ── document store + position math ─────────────────────────────────────

export function positionToOffset(text, { line = 0, character = 0 } = {}) {
  const lines = String(text).split("\n");
  const l = Math.max(0, Math.min(line, lines.length - 1));
  let off = 0;
  for (let i = 0; i < l; i++) off += lines[i].length + 1;
  return off + Math.max(0, Math.min(character, lines[l].length));
}

export function uriToPath(uri) {
  const s = String(uri || "");
  if (s.startsWith("file://")) {
    try {
      return fileURLToPath(s);
    } catch {
      return s.replace(/^file:\/\//, "");
    }
  }
  return s;
}

// ── server core (transport-agnostic; injectable completer for tests) ───

const PREFIX_CAP = 8000; // chars of buffer tail sent as prefix
const SUFFIX_CAP = 2000; // chars of buffer head after cursor

export function createLspServer({ complete, loadCfg, write, exit } = {}) {
  const docs = new Map(); // uri → text
  let rootDir = null;
  let cfgPromise = null;
  const getCfg = () => {
    if (!cfgPromise) {
      cfgPromise = loadCfg
        ? Promise.resolve(loadCfg())
        : import("../config/load.mjs").then((m) => m.loadConfig());
    }
    return cfgPromise;
  };

  async function handle(msg) {
    const { id, method, params } = msg || {};
    const respond = (result) => write?.({ jsonrpc: "2.0", id, result });
    const fail = (code, message) => write?.({ jsonrpc: "2.0", id, error: { code, message } });
    try {
      switch (method) {
        case "initialize": {
          const folder = params?.workspaceFolders?.[0]?.uri || params?.rootUri || null;
          rootDir = folder ? uriToPath(folder) : params?.rootPath || null;
          respond({
            capabilities: {
              textDocumentSync: 1, // Full
              completionProvider: { resolveProvider: false },
            },
            serverInfo: { name: "xclaw-lsp", version: "1.0" },
          });
          return;
        }
        case "initialized":
        case "workspace/didChangeConfiguration":
          return; // notifications — nothing to do
        case "textDocument/didOpen":
          docs.set(params.textDocument.uri, String(params.textDocument.text ?? ""));
          return;
        case "textDocument/didChange": {
          const changes = params.contentChanges || [];
          // Full sync: last full-text change wins
          const full = changes.filter((c) => c.range === undefined).pop();
          if (full) docs.set(params.textDocument.uri, String(full.text ?? ""));
          return;
        }
        case "textDocument/didClose":
          docs.delete(params.textDocument.uri);
          return;
        case "textDocument/completion": {
          const uri = params.textDocument.uri;
          const text = docs.get(uri);
          if (text === undefined) {
            respond({ isIncomplete: false, items: [] });
            return;
          }
          const off = positionToOffset(text, params.position);
          const prefix = text.slice(Math.max(0, off - PREFIX_CAP), off);
          const suffix = text.slice(off, off + SUFFIX_CAP);
          if (!prefix.trim()) {
            respond({ isIncomplete: false, items: [] });
            return;
          }
          const cfg = await getCfg();
          const completer =
            complete || (await import("./service.mjs")).completeCode;
          const out = await completer(cfg, {
            prefix,
            suffix,
            file: uriToPath(uri),
            repoDir: rootDir || undefined,
          });
          const insert = String(out.completion || "");
          if (!insert) {
            respond({ isIncomplete: false, items: [] });
            return;
          }
          respond({
            isIncomplete: false,
            items: [
              {
                label: insert.split("\n")[0].trim().slice(0, 60) || "xclaw completion",
                insertText: insert,
                kind: 1, // Text
                detail: `xclaw · ${out.model || "?"}`,
                documentation: insert.length > 60 ? insert.slice(0, 800) : undefined,
              },
            ],
          });
          return;
        }
        case "shutdown":
          respond(null);
          return;
        case "exit":
          exit?.(0);
          return;
        default:
          if (id !== undefined) fail(-32601, `method not found: ${method}`);
      }
    } catch (e) {
      if (id !== undefined) fail(-32603, e?.message || String(e));
    }
  }

  return { handle, docs, get rootDir() { return rootDir; } };
}

/** Wire the server to stdio (the `xclaw lsp` entrypoint). */
export function runLspStdio() {
  const server = createLspServer({
    write: (msg) => process.stdout.write(encodeFrame(msg)),
    exit: (code) => process.exit(code),
  });
  const parser = createFrameParser();
  process.stdin.on("data", (chunk) => {
    for (const msg of parser.push(chunk)) server.handle(msg);
  });
  process.stdin.on("end", () => process.exit(0));
}
