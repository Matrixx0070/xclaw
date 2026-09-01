/**
 * swarm-ledger.lease must live in the config dir that owns the instance.
 *
 * `leasePath()` resolved `~/.xclaw/swarm-ledger.lease` from
 * `os.homedir()` while production reserve (`acquireLease(cfg)` from
 * `reserveUsd(cfg)`) and doctor (`readLease(cfg)`) already had cfg in
 * scope. Two consequences, same class as v3.297.0 alert-state.json /
 * v3.519.0 swarm-cost-ledger.json:
 *
 *  1. Two xclaw instances on one host with different `paths.configDir`
 *     shared a single lease file, so instance B could not reserve
 *     because instance A held it.
 *  2. The suite wrote into the operator's real `~/.xclaw/swarm-ledger.lease`.
 *
 * Home fallback is refused. `loadConfig()` stamps `paths.configDir`
 * unconditionally (config/load.mjs:187), so a cfg without one is never a
 * real caller. Such a path is `null`. `acquireLease` / `renewLease` no-op
 * a null path (do not `mkdir(null)`). Honour existing `XCLAW_CONFIG_DIR`.
 * No new env.
 */
import { test, describe, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import {
  leasePath,
  acquireLease,
  releaseLease,
  renewLease,
  readLease,
} from "../src/tokens/ledger-lease.mjs";

const HOME_LEASE = path.join(os.homedir(), ".xclaw", "swarm-ledger.lease");
const SAVED_CONFIG_DIR = process.env.XCLAW_CONFIG_DIR;
delete process.env.XCLAW_CONFIG_DIR;

async function tmpDir() {
  return fsp.mkdtemp(path.join(os.tmpdir(), "xclaw-lease-cfg-"));
}

function resolverSlice() {
  const src = fs.readFileSync(
    new URL("../src/tokens/ledger-lease.mjs", import.meta.url),
    "utf8"
  );
  const start = src.indexOf("export function leasePath");
  const end = src.indexOf("export function acquireLease");
  assert.ok(start >= 0 && end > start, "resolver slice not found");
  return src.slice(start, end);
}

describe("ledger-lease follows paths.configDir", () => {
  after(() => {
    if (SAVED_CONFIG_DIR === undefined) delete process.env.XCLAW_CONFIG_DIR;
    else process.env.XCLAW_CONFIG_DIR = SAVED_CONFIG_DIR;
  });

  test("resolves under the config dir, not the home dir", async () => {
    const dir = await tmpDir();
    const cfg = { paths: { configDir: dir } };
    assert.equal(leasePath(cfg), path.join(dir, "swarm-ledger.lease"));
    assert.notEqual(leasePath(cfg), HOME_LEASE);
  });

  test("a write lands in the config dir and never touches the home file", async () => {
    const dir = await tmpDir();
    const homeBefore = fs.existsSync(HOME_LEASE)
      ? fs.readFileSync(HOME_LEASE)
      : null;

    const cfg = { paths: { configDir: dir } };
    const res = acquireLease(cfg, { owner: "pin-520", ttlMs: 30_000 });
    assert.equal(res.ok, true);
    assert.equal(res.skipped, undefined);
    assert.equal(res.owner, "pin-520");
    const raw = fs.readFileSync(path.join(dir, "swarm-ledger.lease"), "utf8");
    assert.ok(raw.includes("pin-520"), "lease did not persist into paths.configDir");
    const got = readLease(cfg);
    assert.equal(got.owner, "pin-520");
    const renewed = renewLease(cfg, { owner: "pin-520", ttlMs: 60_000 });
    assert.equal(renewed.ok, true);
    const released = releaseLease(cfg, { owner: "pin-520" });
    assert.equal(released.ok, true);
    assert.equal(readLease(cfg), null);

    const homeAfter = fs.existsSync(HOME_LEASE)
      ? fs.readFileSync(HOME_LEASE)
      : null;
    assert.deepEqual(homeAfter, homeBefore, "ledger-lease wrote the home swarm-ledger.lease");
  });

  test("XCLAW_CONFIG_DIR still wins when no configDir", async () => {
    const dir = await tmpDir();
    process.env.XCLAW_CONFIG_DIR = dir;
    try {
      assert.equal(leasePath({}), path.join(dir, "swarm-ledger.lease"));
      const res = acquireLease({}, { owner: "pin-520-env", ttlMs: 30_000 });
      assert.equal(res.ok, true);
      const raw = fs.readFileSync(path.join(dir, "swarm-ledger.lease"), "utf8");
      assert.ok(raw.includes("pin-520-env"));
      releaseLease({}, { owner: "pin-520-env" });
    } finally {
      delete process.env.XCLAW_CONFIG_DIR;
    }
  });

  test("with no configDir there is NO home fallback — it names no file and never writes home", async () => {
    assert.equal(leasePath({}), null);
    assert.equal(leasePath(), null);
    assert.notEqual(leasePath({}), HOME_LEASE);

    const homeBefore = fs.existsSync(HOME_LEASE)
      ? fs.readFileSync(HOME_LEASE)
      : null;

    const cwdNull = path.join(process.cwd(), "null");
    const cwdBefore = fs.existsSync(cwdNull);

    const acq = acquireLease({}, { owner: "pin-520-mem", ttlMs: 30_000 });
    assert.equal(acq.ok, true);
    assert.equal(acq.skipped, true);
    assert.equal(readLease({}), null);
    const rel = releaseLease({}, { owner: "pin-520-mem" });
    assert.equal(rel.ok, true);
    assert.equal(rel.reason, "absent");
    const ren = renewLease({}, { owner: "pin-520-mem", ttlMs: 30_000 });
    assert.equal(ren.ok, true);
    assert.equal(ren.skipped, true);

    const homeAfter = fs.existsSync(HOME_LEASE)
      ? fs.readFileSync(HOME_LEASE)
      : null;
    assert.deepEqual(homeAfter, homeBefore, "no-configDir ledger-lease wrote the home file");
    assert.equal(fs.existsSync(cwdNull), cwdBefore, "no-configDir ledger-lease mkdir cwd/null");
  });

  test("resolver body does not home and does not honour XCLAW_STATE_DIR", () => {
    const slice = resolverSlice();
    assert.doesNotMatch(slice, /os\.homedir/);
    assert.doesNotMatch(slice, /XCLAW_STATE_DIR/);
    assert.match(slice, /paths\?\.configDir/);
    assert.match(slice, /XCLAW_CONFIG_DIR/);
  });
});
