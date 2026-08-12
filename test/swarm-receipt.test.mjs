import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  buildNodeReceipt,
  writeNodeReceipt,
  readNodeReceipt,
  listNodeReceipts,
  attachNodeReceipt,
  inferEffects,
} from "../src/agents/swarm-receipt.mjs";

describe("S1 universal swarm receipts", () => {
  let tmp;
  let cfg;
  before(async () => {
    tmp = await fs.mkdtemp(path.join(os.tmpdir(), "xclaw-s1-"));
    cfg = { paths: { configDir: tmp } };
  });
  after(async () => {
    await fs.rm(tmp, { recursive: true, force: true });
  });

  it("inferEffects from tool names", () => {
    const e = inferEffects([
      { name: "xclaw_bash" },
      { name: "xclaw_file_edit" },
      { name: "xclaw_browser_tab" },
    ]);
    assert.ok(e.includes("shell"));
    assert.ok(e.includes("files"));
    assert.ok(e.includes("browser"));
  });

  it("buildNodeReceipt works without browser fields", () => {
    const r = buildNodeReceipt({
      swarmId: "sw1",
      nodeId: "n1",
      goal: "fix the login bug",
      nodeResult: {
        ok: true,
        role: "implement",
        task: "edit auth",
        text: "Changed src/auth.mjs and ran tests",
        toolTrace: [{ name: "xclaw_file_edit" }, { name: "xclaw_bash" }],
      },
    });
    assert.equal(r.kind, "swarm_node");
    assert.equal(r.ok, true);
    assert.ok(r.effects.includes("files"));
    assert.ok(r.effects.includes("shell"));
    assert.ok(!r.effects.includes("browser") || r.browser === null);
    assert.ok(r.artifacts.length >= 1);
  });

  it("write and read receipt", async () => {
    const receipt = buildNodeReceipt({
      swarmId: "sw-write",
      nodeId: "implement-1",
      nodeResult: { ok: true, role: "research", text: "found nothing", toolTrace: [] },
    });
    const w = await writeNodeReceipt(cfg, receipt);
    assert.equal(w.ok, true);
    const loaded = await readNodeReceipt(cfg, "sw-write", "implement-1");
    assert.equal(loaded.id, receipt.id);
    assert.equal(loaded.nodeId, "implement-1");
  });

  it("attachNodeReceipt mutates node result", async () => {
    const nodeResult = {
      nodeId: "n2",
      ok: false,
      role: "verify",
      error: "tests failed",
      toolTrace: [{ name: "xclaw_bash" }],
    };
    const { written } = await attachNodeReceipt(cfg, nodeResult, {
      swarmId: "sw2",
      nodeId: "n2",
      goal: "verify fix",
    });
    assert.equal(written.ok, true);
    assert.ok(nodeResult.receiptId);
    assert.ok(nodeResult.receiptPath);
    assert.equal(nodeResult.receipt.ok, false);
    const list = await listNodeReceipts(cfg, "sw2");
    assert.ok(list.some((r) => r.nodeId === "n2"));
  });

  it("skipped node still builds failure receipt", async () => {
    const nodeResult = {
      nodeId: "downstream",
      ok: false,
      status: "skipped",
      code: "UPSTREAM_FAILED",
      role: "implement",
      error: "skipped: upstream failed (research-1)",
      failedDeps: ["research-1"],
    };
    const { written, receipt } = await attachNodeReceipt(cfg, nodeResult, {
      swarmId: "sw-skip",
      nodeId: "downstream",
      goal: "implement after research",
    });
    assert.equal(written.ok, true);
    assert.equal(receipt.ok, false);
    assert.equal(receipt.status, "skipped");
    assert.equal(receipt.code, "UPSTREAM_FAILED");
  });

  it("browser fields optional on same schema", () => {
    const r = buildNodeReceipt({
      swarmId: "sw3",
      nodeId: "actor-1",
      nodeResult: {
        ok: true,
        role: "actor",
        text: "clicked",
        toolTrace: [{ name: "xclaw_browser_tab" }],
        tabIds: ["t1"],
        actionIds: ["act_1"],
        gateIds: [],
      },
    });
    assert.ok(r.effects.includes("browser"));
    assert.deepEqual(r.tabIds, ["t1"]);
    assert.deepEqual(r.actionIds, ["act_1"]);
  });
});
