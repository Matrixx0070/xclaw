/**
 * Control plane (spec §11.4 + §11.11 + §11.16), pairing-only.
 * Pins: fresh open at v1, absorb pairing.json, refuse newer schema,
 * refuse incomplete shape (do not CREATE the missing table), cache/stop.
 * openControlPlane must not rename pairing.json — live channels still use it.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  CONTROL_SCHEMA_VERSION,
  absorbPairingJson,
  assertControlShape,
  controlPlaneFile,
  getControlPlane,
  openControlPlane,
  pairingJsonFile,
  readSchemaVersion,
  stopControlPlane,
} from "../src/state/control-plane.mjs";

function tmpCfg() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "xclaw-control-"));
  return {
    dir,
    cfg: {
      paths: {
        stateDir: path.join(dir, "state"),
        pairingFile: path.join(dir, "pairing.json"),
      },
    },
  };
}

function writePairing(file, extra = {}) {
  fs.writeFileSync(
    file,
    JSON.stringify({
      channels: {
        telegram: {
          pending: [
            {
              id: "555",
              code: "ABCD2345",
              createdAt: "2026-08-26T00:00:00.000Z",
              lastSeenAt: "2026-08-26T00:00:00.000Z",
              meta: {},
            },
          ],
          approved: [
            {
              id: "777",
              meta: { name: "owner" },
              approvedAt: "2026-08-26T01:00:00.000Z",
            },
          ],
        },
        discord: { pending: [], approved: [] },
      },
      ...extra,
    }) + "\n",
  );
}

describe("control plane", () => {
  it("opens a missing file at CONTROL_SCHEMA_VERSION with the v1 tables", () => {
    const { dir, cfg } = tmpCfg();
    const kit = openControlPlane(cfg);
    try {
      const file = controlPlaneFile(cfg);
      assert.equal(fs.existsSync(file), true);
      assert.equal(readSchemaVersion(kit.db), CONTROL_SCHEMA_VERSION);
      assertControlShape(kit.db);
      const n = kit.prepare("SELECT COUNT(*) AS n FROM pair_pending").get().n;
      assert.equal(n, 0);
    } finally {
      kit.close();
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it("absorbs pairing.json pending/approved then renames the source to .bak", () => {
    const { dir, cfg } = tmpCfg();
    const json = pairingJsonFile(cfg);
    writePairing(json);
    const kit = openControlPlane(cfg);
    try {
      const first = absorbPairingJson(kit, json);
      assert.equal(first.moved, 2);
      assert.equal(fs.existsSync(json), false);
      assert.equal(fs.existsSync(`${json}.bak`), true);
      const pending = kit.prepare("SELECT id, device FROM pair_pending").all();
      const done = kit.prepare("SELECT id, device FROM pair_done").all();
      assert.deepEqual(
        pending.map((r) => r.id).sort(),
        ["telegram:555"],
      );
      assert.equal(pending[0].device, "telegram");
      assert.deepEqual(
        done.map((r) => r.id).sort(),
        ["telegram:777"],
      );
      const payload = JSON.parse(
        kit.prepare("SELECT payload FROM pair_done WHERE id = ?").get("telegram:777").payload,
      );
      assert.equal(payload.id, "777");
      const again = absorbPairingJson(kit, json);
      assert.equal(again.moved, 0);
    } finally {
      kit.close();
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it("openControlPlane does not absorb or rename pairing.json", () => {
    const { dir, cfg } = tmpCfg();
    const json = pairingJsonFile(cfg);
    writePairing(json);
    const kit = openControlPlane(cfg);
    try {
      assert.equal(fs.existsSync(json), true);
      assert.equal(fs.existsSync(`${json}.bak`), false);
      assert.equal(kit.prepare("SELECT COUNT(*) AS n FROM pair_pending").get().n, 0);
      assert.equal(kit.prepare("SELECT COUNT(*) AS n FROM pair_done").get().n, 0);
    } finally {
      kit.close();
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it("refuses a schema_meta.version newer than this binary and does not write", () => {
    const { dir, cfg } = tmpCfg();
    const first = openControlPlane(cfg);
    first.prepare("UPDATE schema_meta SET version = 99 WHERE key = ?").run("control");
    first.close();
    let err;
    try {
      openControlPlane(cfg);
    } catch (e) {
      err = e;
    }
    try {
      assert.ok(err, "newer schema must refuse");
      assert.equal(err.code, "XCLAW_SCHEMA_NEWER");
      assert.match(err.message, /upgrade the gateway binary/);
      const probe = fs.readFileSync(controlPlaneFile(cfg));
      assert.ok(probe.length > 0);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it("refuses a v1 file missing a stable table and does not recreate it", async () => {
    const { dir, cfg } = tmpCfg();
    const first = openControlPlane(cfg);
    first.exec("DROP TABLE pair_pending");
    first.close();
    let err;
    try {
      openControlPlane(cfg);
    } catch (e) {
      err = e;
    }
    try {
      assert.ok(err, "incomplete shape must refuse");
      assert.equal(err.code, "XCLAW_SCHEMA_INCOMPLETE");
      assert.match(err.message, /pair_pending/);
      const { openKit } = await import("../src/persist/query-kit.mjs");
      const probe = openKit(controlPlaneFile(cfg), { label: "probe" });
      try {
        const names = probe
          .prepare("SELECT name FROM sqlite_master WHERE type='table'")
          .all()
          .map((r) => r.name);
        assert.equal(names.includes("pair_pending"), false);
      } finally {
        probe.close();
      }
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it("getControlPlane caches one handle; stopControlPlane closes it", () => {
    const { dir, cfg } = tmpCfg();
    stopControlPlane();
    try {
      const a = getControlPlane(cfg);
      const b = getControlPlane(cfg);
      assert.equal(a, b);
      assert.equal(a.db.isOpen, true);
      stopControlPlane();
      assert.equal(a.db.isOpen, false);
      const c = getControlPlane(cfg);
      assert.notEqual(c, a);
      assert.equal(c.db.isOpen, true);
      stopControlPlane();
    } finally {
      stopControlPlane();
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});
