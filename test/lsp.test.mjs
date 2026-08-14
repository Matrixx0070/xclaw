import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";

import {
  createFrameParser,
  encodeFrame,
  positionToOffset,
  uriToPath,
  createLspServer,
} from "../src/completion/lsp.mjs";

describe("LSP framing", () => {
  it("parses frames split across arbitrary chunk boundaries", () => {
    const p = createFrameParser();
    const frame = encodeFrame({ jsonrpc: "2.0", id: 1, method: "x" });
    const half = Math.floor(frame.length / 2);
    assert.deepEqual(p.push(frame.slice(0, half)), []);
    const msgs = p.push(frame.slice(half));
    assert.equal(msgs.length, 1);
    assert.equal(msgs[0].method, "x");
  });
  it("parses back-to-back frames in one chunk", () => {
    const p = createFrameParser();
    const two = Buffer.concat([
      encodeFrame({ id: 1, method: "a" }),
      encodeFrame({ id: 2, method: "b" }),
    ]);
    const msgs = p.push(two);
    assert.deepEqual(msgs.map((m) => m.method), ["a", "b"]);
  });
});

describe("position/uri helpers", () => {
  it("positionToOffset over multi-line text", () => {
    const text = "abc\ndef\nghi";
    assert.equal(positionToOffset(text, { line: 0, character: 2 }), 2);
    assert.equal(positionToOffset(text, { line: 1, character: 0 }), 4);
    assert.equal(positionToOffset(text, { line: 2, character: 3 }), 11);
    assert.equal(positionToOffset(text, { line: 9, character: 99 }), 11, "clamped");
  });
  it("uriToPath handles file:// and passthrough", () => {
    assert.equal(uriToPath("file:///tmp/x.js"), "/tmp/x.js");
    assert.equal(uriToPath("/plain/path.js"), "/plain/path.js");
  });
});

describe("LSP server core (in-process, injected completer)", () => {
  function makeServer(completeImpl) {
    const out = [];
    const server = createLspServer({
      complete: completeImpl,
      loadCfg: () => ({}),
      write: (m) => out.push(m),
      exit: () => out.push({ exited: true }),
    });
    return { server, out };
  }

  it("initialize → didOpen → completion round-trip with correct FIM split", async () => {
    let seen = null;
    const { server, out } = makeServer(async (cfg, opts) => {
      seen = opts;
      return { completion: "return a + b;", model: "fake-1" };
    });
    await server.handle({
      id: 1,
      method: "initialize",
      params: { rootUri: "file:///repo" },
    });
    assert.equal(out[0].result.capabilities.completionProvider.resolveProvider, false);
    assert.equal(server.rootDir, "/repo");

    const text = "function add(a, b) {\n  \n}\n";
    await server.handle({
      method: "textDocument/didOpen",
      params: { textDocument: { uri: "file:///repo/src/add.js", text } },
    });
    await server.handle({
      id: 2,
      method: "textDocument/completion",
      params: {
        textDocument: { uri: "file:///repo/src/add.js" },
        position: { line: 1, character: 2 },
      },
    });
    assert.equal(seen.prefix, "function add(a, b) {\n  ");
    assert.equal(seen.suffix, "\n}\n");
    assert.equal(seen.file, "/repo/src/add.js");
    assert.equal(seen.repoDir, "/repo");
    const items = out[1].result.items;
    assert.equal(items.length, 1);
    assert.equal(items[0].insertText, "return a + b;");
    assert.match(items[0].detail, /fake-1/);
  });

  it("didChange full-sync replaces the buffer; unknown method → -32601", async () => {
    const { server, out } = makeServer(async () => ({ completion: "x" }));
    await server.handle({ method: "textDocument/didOpen", params: { textDocument: { uri: "u", text: "old" } } });
    await server.handle({ method: "textDocument/didChange", params: { textDocument: { uri: "u" }, contentChanges: [{ text: "new" }] } });
    assert.equal(server.docs.get("u"), "new");
    await server.handle({ id: 9, method: "nope/nope" });
    assert.equal(out.at(-1).error.code, -32601);
  });

  it("empty buffer / unopened doc → empty completion list, no completer call", async () => {
    let called = 0;
    const { server, out } = makeServer(async () => { called++; return { completion: "x" }; });
    await server.handle({ id: 3, method: "textDocument/completion", params: { textDocument: { uri: "ghost" }, position: { line: 0, character: 0 } } });
    assert.deepEqual(out.at(-1).result.items, []);
    assert.equal(called, 0);
  });
});

describe("spawned `xclaw lsp` stdio handshake", () => {
  it("initialize → shutdown → exit over real stdio framing", async () => {
    const child = spawn(process.execPath, ["bin/xclaw.mjs", "lsp"], {
      cwd: "/root/xclaw",
      stdio: ["pipe", "pipe", "pipe"],
    });
    const parser = createFrameParser();
    const replies = [];
    child.stdout.on("data", (c) => replies.push(...parser.push(c)));
    child.stdin.write(encodeFrame({ jsonrpc: "2.0", id: 1, method: "initialize", params: {} }));
    child.stdin.write(encodeFrame({ jsonrpc: "2.0", id: 2, method: "shutdown" }));
    child.stdin.write(encodeFrame({ jsonrpc: "2.0", method: "exit" }));
    const code = await new Promise((resolve) => child.on("close", resolve));
    assert.equal(code, 0);
    assert.equal(replies[0].id, 1);
    assert.equal(replies[0].result.serverInfo.name, "xclaw-lsp");
    assert.equal(replies[1].id, 2);
    assert.equal(replies[1].result, null);
  });
});
