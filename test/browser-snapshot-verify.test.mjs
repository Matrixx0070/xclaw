import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { createBrowserSnapshotTool } from "../src/tools/browser-tools.mjs";

function toolFor(callTool) {
  return createBrowserSnapshotTool({
    computer: { callTool },
    sessionId: "sess-1",
    workingDir: "/tmp",
  });
}

const structure = {
  channel: "structure",
  title: "Hi",
  url: "https://example.test/",
  readyState: "complete",
  nodeCount: 1,
  nodes: [{ mark: 1, role: "button", name: "Go", depth: 0, bbox: { cx: 10, cy: 10 } }],
};

describe("browser_snapshot does not claim structure without nodes", () => {
  it("computer isError is isError, not structure (raw)", async () => {
    const tool = toolFor(async () => ({
      isError: true,
      content: [{ type: "text", text: "CUA_JS_FAILED" }],
    }));
    const out = await tool.execute({});
    assert.equal(out.isError, true);
    assert.match(out.content[0].text, /CUA_JS_FAILED/);
    assert.doesNotMatch(out.content[0].text, /^channel: structure/);
  });

  it("computer ok:false is isError", async () => {
    const tool = toolFor(async () => ({ ok: false, error: "SESSION_GONE" }));
    const out = await tool.execute({});
    assert.equal(out.isError, true);
    assert.match(out.content[0].text, /SESSION_GONE/);
  });

  it("unparsed JS / empty content is STRUCTURE_PARSE_FAILED", async () => {
    const tool = toolFor(async () => ({
      content: [{ type: "text", text: "tab opened, no json" }],
    }));
    const out = await tool.execute({});
    assert.equal(out.isError, true);
    assert.match(out.content[0].text, /STRUCTURE_PARSE_FAILED/);
  });

  it("jsCode wrapper value.nodes is success", async () => {
    const tool = toolFor(async () => ({
      ok: true,
      action: "jsCode",
      value: structure,
    }));
    const out = await tool.execute({});
    assert.ok(!out.isError, JSON.stringify(out).slice(0, 200));
    assert.match(out.content[0].text, /channel: structure/);
    assert.match(out.content[0].text, /Go/);
  });

  it("content JSON with empty nodes is success, not parse failure", async () => {
    const tool = toolFor(async () => ({
      content: [
        {
          type: "text",
          text: JSON.stringify({ channel: "structure", title: "empty", url: "https://x.test/", nodes: [] }),
        },
      ],
    }));
    const out = await tool.execute({});
    assert.ok(!out.isError, JSON.stringify(out).slice(0, 200));
    assert.match(out.content[0].text, /no interactive nodes/);
  });
});
