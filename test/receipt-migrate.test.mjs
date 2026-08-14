
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  migrateReceiptStatusFields,
  migrateReceiptsInDir,
  normalizeReceiptStatus,
} from "../src/agents/swarm-receipt.mjs";

describe("receipt status migration", () => {
  it("migrateReceiptStatusFields maps COMPLETE to done", () => {
    const m = migrateReceiptStatusFields({
      id: "rcpt_abc",
      v: 1,
      kind: "swarm_node",
      swarmId: "s",
      nodeId: "n",
      ok: true,
      status: "COMPLETE",
      at: "2026-01-01T00:00:00.000Z",
    });
    assert.equal(m.changed, true);
    assert.equal(m.to, "done");
    assert.equal(m.receipt.status, "done");
  });

  it("no change when already enum", () => {
    const m = migrateReceiptStatusFields({
      id: "rcpt_abc",
      v: 1,
      kind: "swarm_node",
      swarmId: "s",
      nodeId: "n",
      ok: false,
      status: "skipped",
      at: "2026-01-01T00:00:00.000Z",
    });
    assert.equal(m.changed, false);
  });

  it("migrateReceiptsInDir dry-run does not write", async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "rcpt-mig-"));
    const fp = path.join(dir, "node1.json");
    await fs.writeFile(
      fp,
      JSON.stringify({
        id: "rcpt_deadbeef",
        v: 1,
        kind: "swarm_node",
        swarmId: "s",
        nodeId: "node1",
        ok: true,
        status: "success",
        at: "2026-01-01T00:00:00.000Z",
        effects: [],
        artifacts: [],
      })
    );
    const r = await migrateReceiptsInDir(dir, { dryRun: true });
    assert.equal(r.changed, 1);
    const onDisk = JSON.parse(await fs.readFile(fp, "utf8"));
    assert.equal(onDisk.status, "success"); // unchanged
    const w = await migrateReceiptsInDir(dir, { write: true });
    assert.equal(w.changed, 1);
    const after = JSON.parse(await fs.readFile(fp, "utf8"));
    assert.equal(after.status, "done");
  });
});
