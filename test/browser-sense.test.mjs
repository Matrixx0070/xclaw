import { describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  createActionId,
  networkCursor,
  networkDeltaSince,
  bindActionFlows,
  formatA11ySnapshot,
  assertOutcome,
  STRUCTURE_SNAPSHOT_JS,
  withNetworkBinding,
} from "../src/browser/sense.mjs";
import { createBrowserTools } from "../src/tools/browser-tools.mjs";

describe("Horizon 1 Fusion Sense", () => {
  it("createActionId is unique and prefixed", () => {
    const a = createActionId("t");
    const b = createActionId("t");
    assert.ok(a.startsWith("act_"));
    assert.notEqual(a, b);
  });

  it("networkCursor reports mitm flag", () => {
    const c = networkCursor();
    assert.ok(typeof c.ts === "number");
    assert.ok(typeof c.mitm === "boolean");
  });

  it("formatA11ySnapshot renders roles", () => {
    const text = formatA11ySnapshot([
      { role: { value: "button" }, name: { value: "Submit" }, depth: 1 },
      { role: "link", name: "Home", depth: 1, ignored: false },
      { role: "none", ignored: true, name: "skip" },
    ]);
    assert.ok(text.includes("[button]"));
    assert.ok(text.includes("Submit"));
    assert.ok(text.includes("[link]"));
    assert.ok(!text.includes("skip"));
  });

  it("assertOutcome matches host/method/status", () => {
    const flows = [
      { host: "api.example.com", method: "POST", path: "/v1/pay", status: 201, ts: 1 },
      { host: "cdn.example.com", method: "GET", path: "/x.js", status: 200, ts: 2 },
    ];
    const ok = assertOutcome(
      { host: "api.example.com", method: "POST", status: 201, minFlows: 1 },
      flows
    );
    assert.equal(ok.ok, true);
    assert.equal(ok.matchedCount, 1);

    const bad = assertOutcome({ host: "api.example.com", status: 500 }, flows);
    assert.equal(bad.ok, false);
    assert.ok(bad.failures.length);
  });

  it("STRUCTURE_SNAPSHOT_JS is runnable shape", () => {
    assert.ok(STRUCTURE_SNAPSHOT_JS.includes("querySelectorAll"));
    assert.ok(STRUCTURE_SNAPSHOT_JS.includes("channel"));
  });

  it("withNetworkBinding attaches actionId metadata", async () => {
    const inner = async () => ({
      content: [{ type: "text", text: "hello" }],
    });
    const wrapped = withNetworkBinding(inner, { label: "test" });
    const r = await wrapped({});
    assert.ok(r.metadata?.actionId?.startsWith("act_"));
    assert.ok(r.metadata?.network);
  });

  it("bindActionFlows writes jsonl when confdir set", async () => {
    const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "xclaw-sense-"));
    process.env.XCLAW_MITM_CONFDIR = tmp;
    try {
      const id = createActionId("bind");
      await bindActionFlows(id, [
        { ts: 1, method: "GET", host: "h", path: "/", status: 200 },
      ]);
      const raw = await fs.readFile(path.join(tmp, "action-bindings.jsonl"), "utf8");
      assert.ok(raw.includes(id));
    } finally {
      delete process.env.XCLAW_MITM_CONFDIR;
      await fs.rm(tmp, { recursive: true, force: true });
    }
  });

  it("browser tools register observe + assert", () => {
    const names = createBrowserTools({}).map((t) => t.name);
    assert.ok(names.includes("browser_observe"));
    assert.ok(names.includes("browser_assert"));
    assert.ok(names.includes("browser_snapshot"));
  });
});
