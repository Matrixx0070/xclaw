import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { createBrowserClipboardTool } from "../src/tools/browser-tools.mjs";

function toolFor(callTool) {
  return createBrowserClipboardTool({
    computer: { callTool },
    sessionId: "sess-1",
    workingDir: "/tmp",
  });
}

describe("browser_clipboard does not claim success on JS ok:false", () => {
  it("permission / JS failure in content text is isError", async () => {
    const tool = toolFor(async () => ({
      content: [{ type: "text", text: JSON.stringify({ ok: false, error: "NotAllowedError" }) }],
    }));
    const out = await tool.execute({ action: "read" });
    assert.equal(out.isError, true);
    assert.match(out.content[0].text, /NotAllowedError/);
  });

  it("jsCode wrapper with value.ok false is isError, even when computer ok is true", async () => {
    const tool = toolFor(async () => ({
      ok: true,
      action: "jsCode",
      value: { ok: false, error: "Document is not focused." },
    }));
    const out = await tool.execute({ action: "write", text: "hi" });
    assert.equal(out.isError, true);
    assert.match(out.content[0].text, /not focused/i);
  });

  it("computer-level ok:false is isError", async () => {
    const tool = toolFor(async () => ({
      ok: false,
      error: "CUA_JS_FAILED",
      code: "CUA_JS_FAILED",
    }));
    const out = await tool.execute({ action: "read" });
    assert.equal(out.isError, true);
    assert.match(out.content[0].text, /CUA_JS_FAILED/);
  });

  it("result.isError is isError", async () => {
    const tool = toolFor(async () => ({
      isError: true,
      content: [{ type: "text", text: "session gone" }],
    }));
    const out = await tool.execute({ action: "read" });
    assert.equal(out.isError, true);
    assert.match(out.content[0].text, /session gone/);
  });

  it("successful read returns the clipboard text, not isError", async () => {
    const tool = toolFor(async () => ({
      content: [{ type: "text", text: JSON.stringify({ ok: true, action: "read", text: "hello clip" }) }],
    }));
    const out = await tool.execute({ action: "read" });
    assert.ok(!out.isError, JSON.stringify(out).slice(0, 200));
    assert.equal(out.content[0].text, "hello clip");
  });

  it("successful write is not isError", async () => {
    const tool = toolFor(async () => ({
      ok: true,
      action: "jsCode",
      value: { ok: true, action: "write", len: 2 },
    }));
    const out = await tool.execute({ action: "write", text: "hi" });
    assert.ok(!out.isError, JSON.stringify(out).slice(0, 200));
    assert.match(out.content[0].text, /clipboard write ok/);
  });
});
