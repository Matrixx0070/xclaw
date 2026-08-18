/**
 * Checkpoint schema v1 freeze + legacy migration.
 */
import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import {
  RECEIPT_SCHEMA_V1,
  validateReceiptShape,
  normalizeReceiptStatus,
} from "../src/agents/swarm-receipt.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

describe("checkpoint schema freeze", () => {
  let tmp;
  let cfg;
  let validateCheckpointShape;
  let migrateCheckpoint;
  let saveCheckpoint;
  let loadCheckpoint;
  let CHECKPOINT_SCHEMA_VERSION;
  let CHECKPOINT_SCHEMA_V1;

  before(async () => {
    spawnSync(process.execPath, [path.join(root, "scripts/apply-ship-patches.mjs")], {
      cwd: root,
      encoding: "utf8",
    });
    // apply checkpoint schema patch if listed
    const patch = path.join(root, "patches/checkpoint-schema-v1.patch");
    spawnSync("git", ["apply", "--whitespace=nowarn", patch], {
      cwd: root,
      encoding: "utf8",
    });
    ({
      CHECKPOINT_SCHEMA_VERSION,
      CHECKPOINT_SCHEMA_V1,
      validateCheckpointShape,
      migrateCheckpoint,
      saveCheckpoint,
      loadCheckpoint,
    } = await import("../src/jobs/checkpoint.mjs"));
    tmp = await fs.mkdtemp(path.join(os.tmpdir(), "xclaw-ckpt-schema-"));
    cfg = { paths: { configDir: tmp } };
  });

  after(async () => {
    await fs.rm(tmp, { recursive: true, force: true });
  });

  it("exports frozen v1 schema", () => {
    assert.equal(CHECKPOINT_SCHEMA_VERSION, 1);
    assert.equal(CHECKPOINT_SCHEMA_V1.schemaVersion, 1);
    assert.ok(CHECKPOINT_SCHEMA_V1.required.includes("schemaVersion"));
  });

  it("validate rejects missing id", () => {
    const r = validateCheckpointShape({
      goal: "x",
      status: "running",
      at: "t",
      schemaVersion: 1,
    });
    assert.equal(r.ok, false);
    assert.ok(r.errors.some((e) => /id/.test(e)));
  });

  it("migrate legacy without schemaVersion", () => {
    const legacy = {
      id: "job_legacy",
      goal: "do thing",
      status: "running",
      at: "2020-01-01T00:00:00.000Z",
    };
    const m = migrateCheckpoint(legacy);
    assert.equal(m.migrated, true);
    assert.equal(m.receipt.schemaVersion, 1);
    const v = validateCheckpointShape(m.receipt);
    assert.equal(v.ok, true, JSON.stringify(v.errors));
  });

  it("saveCheckpoint stamps schemaVersion; load migrates", async () => {
    await saveCheckpoint(cfg, {
      id: "job_new",
      goal: "g",
      status: "running",
      turns: 1,
    });
    const loaded = await loadCheckpoint(cfg, "job_new");
    assert.equal(loaded.schemaVersion, 1);
    assert.equal(validateCheckpointShape(loaded).ok, true);
  });

  it("load migrates on-disk legacy file", async () => {
    const d = path.join(tmp, "checkpoints");
    await fs.mkdir(d, { recursive: true });
    await fs.writeFile(
      path.join(d, "job_old.json"),
      JSON.stringify({
        id: "job_old",
        goal: "legacy",
        status: "running",
        at: "2019-01-01T00:00:00.000Z",
      })
    );
    const loaded = await loadCheckpoint(cfg, "job_old");
    assert.equal(loaded.schemaVersion, 1);
    assert.equal(loaded.id, "job_old");
  });
});

describe("receipt schema freeze still v1", () => {
  it("RECEIPT_SCHEMA_V1 requires v=1", () => {
    assert.equal(RECEIPT_SCHEMA_V1.properties.v.const, 1);
    const good = {
      id: "rcpt_abc",
      v: 1,
      kind: "swarm_node",
      swarmId: "s1",
      nodeId: "n1",
      ok: true,
      status: "done",
      at: "2026-01-01T00:00:00.000Z",
    };
    assert.equal(validateReceiptShape(good).ok, true);
    assert.equal(normalizeReceiptStatus("success", true), "done");
  });
});
