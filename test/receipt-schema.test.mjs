
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  buildNodeReceipt,
  validateReceiptShape,
  writeNodeReceipt,
  RECEIPT_SCHEMA_V1,
} from "../src/agents/swarm-receipt.mjs";
import os from "node:os";
import path from "node:path";
import fs from "node:fs/promises";

function validReceipt(over = {}) {
  return {
    id: "rcpt_deadbeef",
    v: 1,
    kind: "swarm_node",
    swarmId: "swarm1",
    nodeId: "n1",
    ok: true,
    status: "done",
    at: new Date().toISOString(),
    effects: [],
    artifacts: [],
    ...over,
  };
}

describe("receipt JSON schema validation", () => {
  it("RECEIPT_SCHEMA_V1 is v1 swarm_node", () => {
    assert.equal(RECEIPT_SCHEMA_V1.properties.v.const, 1);
    assert.equal(RECEIPT_SCHEMA_V1.properties.kind.const, "swarm_node");
  });

  it("accepts a valid receipt", () => {
    const r = validateReceiptShape(validReceipt());
    assert.equal(r.ok, true);
    assert.equal(r.errors.length, 0);
  });

  it("rejects missing id / wrong kind", () => {
    const r = validateReceiptShape(validReceipt({ id: undefined, kind: "other" }));
    assert.equal(r.ok, false);
    assert.ok(r.errors.some((e) => /id/.test(e)));
    assert.ok(r.errors.some((e) => /kind/.test(e)));
  });

  it("rejects non-rcpt id prefix", () => {
    const r = validateReceiptShape(validReceipt({ id: "x_1" }));
    assert.equal(r.ok, false);
  });

  it("ok=false is valid", () => {
    const r = validateReceiptShape(
      validReceipt({ ok: false, status: "error" })
    );
    assert.equal(r.ok, true);
  });

  it("strictOutcome catches ok/status mismatch", () => {
    const r = validateReceiptShape(
      validReceipt({ ok: true, status: "error" }),
      { strictOutcome: true }
    );
    assert.equal(r.ok, false);
  });

  it("buildNodeReceipt output validates", () => {
    const receipt = buildNodeReceipt({
      swarmId: "s1",
      nodeId: "prepare",
      goal: "test",
      nodeResult: {
        ok: true,
        status: "done",
        role: "implement",
        toolTrace: [{ name: "xclaw_bash", ok: true }],
      },
    });
    const v = validateReceiptShape(receipt);
    assert.equal(v.ok, true, v.errors.join("; "));
  });

  it("writeNodeReceipt rejects invalid shape", async () => {
    const cfg = {
      paths: { configDir: await fs.mkdtemp(path.join(os.tmpdir(), "rcpt-sch-")) },
    };
    const bad = { swarmId: "s", nodeId: "n", ok: true };
    const w = await writeNodeReceipt(cfg, bad);
    assert.equal(w.ok, false);
    assert.equal(w.code, "RECEIPT_SCHEMA_INVALID");
  });
});
