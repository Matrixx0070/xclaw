import { describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  preValidateReceiptForMigration,
  migrateReceiptsInDir,
  resolveBeforeWriteDecision,
  createBeforeWriteGuard,
} from "../src/agents/swarm-receipt.mjs";

describe("pre-migration validation hooks", () => {
  it("preValidateReceiptForMigration accepts migratable legacy status", () => {
    const pre = preValidateReceiptForMigration({
      id: "rcpt_abc12345",
      swarmId: "s1",
      nodeId: "n1",
      ok: true,
      status: "COMPLETE",
      v: 1,
    });
    assert.equal(pre.canMigrate, true);
  });

  it("preValidate rejects missing identity", () => {
    const pre = preValidateReceiptForMigration({ ok: true, status: "done" });
    assert.equal(pre.canMigrate, false);
    assert.ok(pre.errors.length > 0);
  });

  it("requirePreValid skips broken files and still migrates good ones", async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "rcpt-pre-"));
    await fs.writeFile(
      path.join(dir, "good.json"),
      JSON.stringify({
        id: "rcpt_good0001",
        v: 1,
        kind: "swarm_node",
        swarmId: "s",
        nodeId: "good",
        ok: true,
        status: "success",
        at: "2026-01-01T00:00:00.000Z",
        effects: [],
        artifacts: [],
      })
    );
    await fs.writeFile(
      path.join(dir, "bad.json"),
      JSON.stringify({ status: "success" })
    );
    const skips = [];
    await migrateReceiptsInDir(dir, {
      write: true,
      requirePreValid: true,
      hooks: { onSkip: (x) => skips.push(x) },
    });
    assert.ok(skips.some((s) => s.reason === "pre_validation_failed"));
    const good = JSON.parse(
      await fs.readFile(path.join(dir, "good.json"), "utf8")
    );
    assert.equal(good.status, "done");
    const bad = JSON.parse(await fs.readFile(path.join(dir, "bad.json"), "utf8"));
    assert.equal(bad.status, "success");
  });

  it("beforeWrite returning false blocks write", async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "rcpt-bw-"));
    const fp = path.join(dir, "n.json");
    await fs.writeFile(
      fp,
      JSON.stringify({
        id: "rcpt_block001",
        v: 1,
        kind: "swarm_node",
        swarmId: "s",
        nodeId: "n",
        ok: true,
        status: "success",
        at: "2026-01-01T00:00:00.000Z",
        effects: [],
        artifacts: [],
      })
    );
    await migrateReceiptsInDir(dir, {
      write: true,
      hooks: { beforeWrite: () => false },
    });
    const onDisk = JSON.parse(await fs.readFile(fp, "utf8"));
    assert.equal(onDisk.status, "success");
  });
});

describe("beforeWrite decision logic", () => {
  it("resolveBeforeWriteDecision normalizes forms", () => {
    assert.equal(resolveBeforeWriteDecision(true).allow, true);
    assert.equal(resolveBeforeWriteDecision(undefined).allow, true);
    assert.equal(resolveBeforeWriteDecision(false).allow, false);
    assert.equal(resolveBeforeWriteDecision("nope").reason, "nope");
    assert.equal(
      resolveBeforeWriteDecision({ allow: false, reason: "x" }).reason,
      "x"
    );
    assert.equal(resolveBeforeWriteDecision({ ok: true }).allow, true);
  });

  it("createBeforeWriteGuard blocks invalid shape", async () => {
    const g = createBeforeWriteGuard();
    const d = resolveBeforeWriteDecision(
      await g({ receipt: { status: "done" }, file: "a.json" })
    );
    assert.equal(d.allow, false);
    assert.ok(
      d.reason === "post_shape_invalid" || d.reason === "invalid_receipt_id"
    );
  });

  it("user beforeWrite can deny after guard passes", async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "rcpt-deny-"));
    const fp = path.join(dir, "n.json");
    await fs.writeFile(
      fp,
      JSON.stringify({
        id: "rcpt_deny0001",
        v: 1,
        kind: "swarm_node",
        swarmId: "s",
        nodeId: "n",
        ok: true,
        status: "success",
        at: "2026-01-01T00:00:00.000Z",
        effects: [],
        artifacts: [],
      })
    );
    const r = await migrateReceiptsInDir(dir, {
      write: true,
      hooks: {
        beforeWrite: () => ({ allow: false, reason: "policy_hold" }),
      },
    });
    const row = r.results[0];
    assert.equal(row.written, false);
    assert.equal(row.writeDeniedReason, "policy_hold");
    const onDisk = JSON.parse(await fs.readFile(fp, "utf8"));
    assert.equal(onDisk.status, "success");
  });
});
