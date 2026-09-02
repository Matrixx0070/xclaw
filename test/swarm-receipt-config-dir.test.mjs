/**
 * swarms/runs/<id>/receipts must live in the config dir that owns the instance.
 *
 * `receiptsDir()` resolved `~/.xclaw/swarms/runs/<id>/receipts` from
 * `os.homedir()` while production writers (`writeNodeReceipt(cfg)` via
 * `attachNodeReceipt(cfg)` at agents/swarm-run.mjs:498/727/755/819) already
 * had cfg in scope.
 * Two consequences, same class as v3.297.0 alert-state.json /
 * v3.543.0 journal:
 *
 *  1. Two xclaw instances on one host with different `paths.configDir`
 *     shared a single receipts tree, so instance B read instance A's proof.
 *  2. The suite wrote into the operator's real `~/.xclaw/swarms`.
 *
 * Home fallback is refused. `loadConfig()` stamps `paths.configDir`
 * unconditionally (config/load.mjs:187), so a cfg without one is never a
 * real caller. Such a path is `null`. `writeNodeReceipt` still returns
 * `{ ok: true, path: null, receipt }` without persisting (do not
 * `mkdir(null)`). Honour existing `XCLAW_CONFIG_DIR`. No new env.
 */
import { test, describe, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import {
  swarmReceiptsRoot,
  receiptsDir,
  writeNodeReceipt,
  readNodeReceipt,
  listNodeReceipts,
} from "../src/agents/swarm-receipt.mjs";

const HOME_SW = path.join(os.homedir(), ".xclaw", "swarms");
const SAVED_CONFIG_DIR = process.env.XCLAW_CONFIG_DIR;
delete process.env.XCLAW_CONFIG_DIR;

async function tmpDir() {
  return fsp.mkdtemp(path.join(os.tmpdir(), "xclaw-rcpt-cfg-"));
}

function homeSwListing() {
  try {
    return fs.readdirSync(HOME_SW).sort();
  } catch {
    return null;
  }
}

function resolverSlice() {
  const src = fs.readFileSync(
    new URL("../src/agents/swarm-receipt.mjs", import.meta.url),
    "utf8"
  );
  const start = src.indexOf("export function swarmReceiptsRoot");
  const end = src.indexOf("export function inferEffects");
  assert.ok(start >= 0 && end > start, "resolver slice not found");
  return src.slice(start, end);
}

function validReceipt(over = {}) {
  return {
    id: "rcpt_pin0001",
    v: 1,
    kind: "swarm_node",
    swarmId: "pin-run",
    nodeId: "n1",
    ok: true,
    status: "done",
    at: new Date().toISOString(),
    effects: [],
    artifacts: [],
    ...over,
  };
}

describe("swarm receipts follow paths.configDir", () => {
  after(() => {
    if (SAVED_CONFIG_DIR === undefined) delete process.env.XCLAW_CONFIG_DIR;
    else process.env.XCLAW_CONFIG_DIR = SAVED_CONFIG_DIR;
  });

  test("resolves under the config dir, not the home dir", async () => {
    const dir = await tmpDir();
    const cfg = { paths: { configDir: dir } };
    assert.equal(swarmReceiptsRoot(cfg), path.join(dir, "swarms"));
    assert.notEqual(swarmReceiptsRoot(cfg), HOME_SW);
    assert.equal(
      receiptsDir(cfg, "run1"),
      path.join(dir, "swarms", "runs", "run1", "receipts")
    );
  });

  test("a write lands in the config dir and never touches the home swarms dir", async () => {
    const dir = await tmpDir();
    const homeBefore = homeSwListing();

    const cfg = { paths: { configDir: dir } };
    const written = await writeNodeReceipt(cfg, validReceipt());
    assert.equal(written.ok, true);
    assert.equal(written.receipt.nodeId, "n1");
    assert.ok(
      written.path.endsWith(path.join("swarms", "runs", "pin-run", "receipts", "n1.json"))
    );
    const loaded = await readNodeReceipt(cfg, "pin-run", "n1");
    assert.equal(loaded.id, "rcpt_pin0001");
    const listed = await listNodeReceipts(cfg, "pin-run");
    assert.equal(listed.length, 1);
    assert.equal(listed[0].id, "rcpt_pin0001");
    assert.ok(
      fs.existsSync(
        path.join(dir, "swarms", "runs", "pin-run", "receipts", "n1.json")
      ),
      "receipt did not persist into paths.configDir"
    );

    assert.deepEqual(homeSwListing(), homeBefore, "receipt wrote the home swarms dir");
  });

  test("XCLAW_CONFIG_DIR still wins when no configDir", async () => {
    const dir = await tmpDir();
    process.env.XCLAW_CONFIG_DIR = dir;
    try {
      assert.equal(swarmReceiptsRoot({}), path.join(dir, "swarms"));
      const written = await writeNodeReceipt({}, validReceipt({ swarmId: "pin-env", nodeId: "e1" }));
      assert.equal(written.ok, true);
      assert.ok(
        fs.existsSync(
          path.join(dir, "swarms", "runs", "pin-env", "receipts", "e1.json")
        )
      );
    } finally {
      delete process.env.XCLAW_CONFIG_DIR;
    }
  });

  test("with no configDir there is NO home fallback — it names no dir and never writes home", async () => {
    assert.equal(swarmReceiptsRoot({}), null);
    assert.equal(swarmReceiptsRoot(), null);
    assert.equal(receiptsDir({}, "nope"), null);
    assert.notEqual(swarmReceiptsRoot({}), HOME_SW);

    const homeBefore = homeSwListing();
    const cwdNull = path.join(process.cwd(), "null");
    const cwdBefore = fs.existsSync(cwdNull);

    const written = await writeNodeReceipt({}, validReceipt({ swarmId: "nope", nodeId: "n1" }));
    assert.equal(written.ok, true);
    assert.equal(written.path, null);
    assert.equal(written.receipt.nodeId, "n1");
    assert.equal(await readNodeReceipt({}, "nope", "n1"), null);
    assert.deepEqual(await listNodeReceipts({}, "nope"), []);

    assert.deepEqual(homeSwListing(), homeBefore, "no-configDir receipt wrote home swarms dir");
    assert.equal(fs.existsSync(cwdNull), cwdBefore, "no-configDir receipt mkdir cwd/null");
  });

  test("resolver body does not home and does not honour XCLAW_STATE_DIR", () => {
    const slice = resolverSlice();
    assert.doesNotMatch(slice, /os\.homedir/);
    assert.doesNotMatch(slice, /XCLAW_STATE_DIR/);
    assert.match(slice, /paths\?\.configDir/);
    assert.match(slice, /XCLAW_CONFIG_DIR/);
  });
});
