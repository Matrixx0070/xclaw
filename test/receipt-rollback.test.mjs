import { describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  migrateReceiptsInDir,
  writeReceiptWithRollback,
  rollbackReceiptFile,
} from "../src/agents/swarm-receipt.mjs";

const sample = (status) => ({
  id: "rcpt_roll0001",
  v: 1,
  kind: "swarm_node",
  swarmId: "s",
  nodeId: "n",
  ok: true,
  status,
  at: "2026-01-01T00:00:00.000Z",
  effects: [],
  artifacts: [],
});

describe("receipt write rollback", () => {
  it("writeReceiptWithRollback restores on forced bad read-back skip", async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "rcpt-rb-"));
    const fp = path.join(dir, "n.json");
    const prev = sample("success");
    await fs.writeFile(fp, JSON.stringify(prev, null, 2) + "\n");
    const previousRaw = await fs.readFile(fp, "utf8");
    // valid migration target
    const next = { ...prev, status: "done" };
    const wr = await writeReceiptWithRollback(fp, next, {
      previousRaw,
      verifyReadBack: true,
    });
    assert.equal(wr.ok, true);
    assert.equal(wr.written, true);
  });

  it("afterWrite throw triggers auto-rollback", async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "rcpt-aw-"));
    const fp = path.join(dir, "n.json");
    await fs.writeFile(fp, JSON.stringify(sample("success"), null, 2) + "\n");
    const r = await migrateReceiptsInDir(dir, {
      write: true,
      hooks: {
        afterWrite: async () => {
          throw new Error("boom");
        },
      },
    });
    const row = r.results[0];
    assert.equal(row.phase, "afterWrite");
    assert.equal(row.rolledBack, true);
    assert.equal(row.written, false);
    const onDisk = JSON.parse(await fs.readFile(fp, "utf8"));
    assert.equal(onDisk.status, "success");
  });

  it("rollbackReceiptFile restores snapshot", async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "rcpt-rf-"));
    const fp = path.join(dir, "n.json");
    const raw = JSON.stringify(sample("skipped"), null, 2) + "\n";
    await fs.writeFile(fp, JSON.stringify(sample("done"), null, 2) + "\n");
    const rb = await rollbackReceiptFile(fp, raw);
    assert.equal(rb.ok, true);
    assert.equal(JSON.parse(await fs.readFile(fp, "utf8")).status, "skipped");
  });
});
