/**
 * compact-offload must live in the config dir that owns the instance.
 *
 * `defaultOffloadDir()` resolved `~/.xclaw/compact-offload` from
 * `os.homedir()` while production loop already had cfg in scope and
 * called `compactionOptsFromConfig(cfg)` → `compactMessages` with
 * `offloadDir: c.offloadDir` — when offloadDir unset (normal), they
 * homed. Compaction is default-ON. Two consequences, same class as
 * v3.297.0 alert-state.json / v3.507.0 pairing.json / v3.508.0
 * sessions.json / v3.509.0 cost-ledger.jsonl:
 *
 *  1. Two xclaw instances on one host with different `paths.configDir`
 *     shared a single compact-offload map, so instance B's tool
 *     results mixed with instance A's.
 *  2. The suite wrote into the operator's real `~/.xclaw/compact-offload`.
 *
 * Home fallback is refused. `loadConfig()` stamps `paths.configDir`
 * unconditionally (config/load.mjs:187), so a cfg without one is never
 * a real caller. Such a path is `null`. offloadToolResults no-ops a
 * null dir (do not mkdir(null)). Honour existing
 * XCLAW_COMPACT_OFFLOAD_DIR. compactionOptsFromConfig fills offloadDir
 * so live still offloads under configDir.
 */
import { test, describe, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import {
  defaultOffloadDir,
  offloadToolResults,
  compactionOptsFromConfig,
} from "../src/tokens/compaction.mjs";

const HOME_OFFLOAD = path.join(os.homedir(), ".xclaw", "compact-offload");
const SAVED_OFFLOAD_DIR = process.env.XCLAW_COMPACT_OFFLOAD_DIR;
delete process.env.XCLAW_COMPACT_OFFLOAD_DIR;

async function tmpDir() {
  return fsp.mkdtemp(path.join(os.tmpdir(), "xclaw-offload-cfg-"));
}

function homeListing() {
  return fs.existsSync(HOME_OFFLOAD) ? fs.readdirSync(HOME_OFFLOAD).sort() : null;
}

describe("compaction offload follows paths.configDir", () => {
  after(() => {
    if (SAVED_OFFLOAD_DIR === undefined) delete process.env.XCLAW_COMPACT_OFFLOAD_DIR;
    else process.env.XCLAW_COMPACT_OFFLOAD_DIR = SAVED_OFFLOAD_DIR;
  });

  test("resolves under the config dir, not the home dir", async () => {
    const dir = await tmpDir();
    const cfg = { paths: { configDir: dir } };
    assert.equal(defaultOffloadDir({ cfg }), path.join(dir, "compact-offload"));
    assert.notEqual(defaultOffloadDir({ cfg }), HOME_OFFLOAD);
    const opts = compactionOptsFromConfig(cfg);
    assert.equal(opts.offloadDir, path.join(dir, "compact-offload"));
  });

  test("a write lands in the config dir and never touches the home dir", async () => {
    const dir = await tmpDir();
    const homeBefore = homeListing();

    const cfg = { paths: { configDir: dir } };
    const big = "x".repeat(5000);
    const { messages, report } = await offloadToolResults(
      [
        { role: "system", content: "sys" },
        { role: "tool", tool_call_id: "tc-510", content: big },
      ],
      { cfg, thresholdChars: 1000, previewChars: 50 }
    );
    assert.equal(report.offloaded, 1);
    assert.equal(report.dir, path.join(dir, "compact-offload"));
    assert.match(messages[1].content, /\[xclaw-offload\]/);
    const p = messages[1]._offloadPath;
    assert.ok(p.startsWith(path.join(dir, "compact-offload")));
    const body = await fsp.readFile(p, "utf8");
    assert.equal(body.length, 5000);

    assert.deepEqual(homeListing(), homeBefore, "offload wrote the home compact-offload");
  });

  test("an explicit opts.dir still wins over the config dir", async () => {
    const dir = await tmpDir();
    const explicit = path.join(dir, "custom-offload");
    const cfg = {
      paths: { configDir: dir },
      tokens: { compaction: { offloadDir: path.join(dir, "nested-offload") } },
    };
    assert.equal(defaultOffloadDir({ dir: explicit, cfg }), explicit);
  });

  test("nested tokens.compaction.offloadDir wins over configDir", async () => {
    const dir = await tmpDir();
    const nested = path.join(dir, "nested-offload");
    const cfg = {
      paths: { configDir: dir },
      tokens: { compaction: { offloadDir: nested } },
    };
    assert.equal(defaultOffloadDir({ cfg }), nested);
    assert.equal(compactionOptsFromConfig(cfg).offloadDir, nested);
  });

  test("XCLAW_COMPACT_OFFLOAD_DIR wins over configDir when nested unset", async () => {
    const dir = await tmpDir();
    const envDir = path.join(dir, "env-offload");
    process.env.XCLAW_COMPACT_OFFLOAD_DIR = envDir;
    try {
      const cfg = { paths: { configDir: dir } };
      assert.equal(defaultOffloadDir({ cfg }), envDir);
    } finally {
      delete process.env.XCLAW_COMPACT_OFFLOAD_DIR;
    }
  });

  test("with no configDir there is NO home fallback — it names no dir and never writes home", async () => {
    assert.equal(defaultOffloadDir({}), null);
    assert.equal(defaultOffloadDir(), null);
    assert.notEqual(defaultOffloadDir({}), HOME_OFFLOAD);
    assert.equal(compactionOptsFromConfig({}).offloadDir, null);

    const homeBefore = homeListing();

    const big = "y".repeat(5000);
    const { messages, report } = await offloadToolResults(
      [
        { role: "system", content: "sys" },
        { role: "tool", tool_call_id: "tc-510-mem", content: big },
      ],
      { thresholdChars: 1000 }
    );
    assert.equal(report.offloaded, 0);
    assert.equal(report.dir, null);
    assert.equal(report.skipped, true);
    assert.equal(messages[1].content, big);

    assert.deepEqual(homeListing(), homeBefore, "no-configDir offload wrote the home dir");
  });
});
