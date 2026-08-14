
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  preValidateReceiptForMigration,
  migrateReceiptsInDir,
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
    const r = await migrateReceiptsInDir(dir, {
      write: true,
      requirePreValid: true,
      hooks: {
        onSkip: (x) => skips.push(x),
      },
    });
    assert.ok(skips.some((s) => s.reason === "pre_validation_failed"));
    const good = JSON.parse(
      await fs.readFile(path.join(dir, "good.json"), "utf8")
    );
    assert.equal(good.status, "done");
    const bad = JSON.parse(await fs.readFile(path.join(dir, "bad.json"), "utf8"));
    assert.equal(bad.status, "success"); // untouched
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
