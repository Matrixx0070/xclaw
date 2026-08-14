import { describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  isReceiptMigrationIdempotent,
  migrateReceiptsInDir,
  stampReceiptMigration,
} from "../src/agents/swarm-receipt.mjs";

const good = (status) => ({
  id: "rcpt_idem0001",
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

describe("receipt migration idempotency", () => {
  it("isReceiptMigrationIdempotent true for enum+shape", () => {
    const r = isReceiptMigrationIdempotent(good("done"));
    assert.equal(r.idempotent, true);
  });

  it("isReceiptMigrationIdempotent false for legacy status", () => {
    const r = isReceiptMigrationIdempotent(good("success"));
    assert.equal(r.idempotent, false);
    assert.ok(r.reasons.some((x) => /status_not_enum/.test(x)));
  });

  it("second migrate pass skips already migrated files", async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "rcpt-id-"));
    const fp = path.join(dir, "n.json");
    await fs.writeFile(fp, JSON.stringify(good("success"), null, 2) + "\n");
    const first = await migrateReceiptsInDir(dir, { write: true });
    assert.equal(first.changed, 1);
    assert.equal(JSON.parse(await fs.readFile(fp, "utf8")).status, "done");
    const mtime1 = (await fs.stat(fp)).mtimeMs;
    const second = await migrateReceiptsInDir(dir, { write: true });
    assert.equal(second.idempotent, 1);
    assert.equal(second.changed, 0);
    const mtime2 = (await fs.stat(fp)).mtimeMs;
    assert.equal(mtime1, mtime2);
  });

  it("stampReceiptMigration adds meta marker", () => {
    const s = stampReceiptMigration(good("done"));
    assert.ok(s.meta?.statusMigratedAt);
  });
});
