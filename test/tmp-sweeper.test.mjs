import { describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { sweepStaleTmp, isSweepCandidate } from "../src/ops/tmp-sweeper.mjs";

describe("tmp sweeper", () => {
  it("any xclaw- prefixed entry is a candidate; foreign names never", () => {
    assert.equal(isSweepCandidate("xclaw-wt-abc123"), true);
    assert.equal(isSweepCandidate("xclaw-jwks-XYZ"), true);
    assert.equal(isSweepCandidate("xclaw-merge-a1.patch"), true);
    assert.equal(isSweepCandidate("systemd-private-x"), false);
    assert.equal(isSweepCandidate("npm-cache"), false);
    assert.equal(isSweepCandidate("xclawish"), false);
  });

  it("removes only old candidates; keeps fresh, foreign, and mission-referenced", async () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "sweeper-root-"));
    const cfgDir = fs.mkdtempSync(path.join(os.tmpdir(), "sweeper-cfg-"));
    fs.mkdirSync(path.join(cfgDir, "missions"), { recursive: true });
    const old = Date.now() / 1000 - 3 * 24 * 3600;

    const mk = (name, ageOld) => {
      const p = path.join(tmp, name);
      fs.mkdirSync(p);
      fs.writeFileSync(path.join(p, "f"), "x");
      if (ageOld) fs.utimesSync(p, old, old);
      return p;
    };
    mk("xclaw-wt-stale", true);
    mk("xclaw-wtmerge-stale", true);
    mk("xclaw-wt-fresh", false);
    mk("unrelated-dir", true);
    const referenced = mk("xclaw-wt-referenced", true);
    fs.writeFileSync(
      path.join(cfgDir, "missions", "msn_x.json"),
      JSON.stringify({ id: "msn_x", worktree: { path: referenced } })
    );

    const cfg = { paths: { configDir: cfgDir } };
    const dry = await sweepStaleTmp(cfg, { tmpdir: tmp, dryRun: true });
    assert.deepEqual(dry.removed.sort(), ["xclaw-wt-stale", "xclaw-wtmerge-stale"]);
    assert.ok(fs.existsSync(path.join(tmp, "xclaw-wt-stale")), "dry-run removes nothing");

    const real = await sweepStaleTmp(cfg, { tmpdir: tmp });
    assert.deepEqual(real.removed.sort(), ["xclaw-wt-stale", "xclaw-wtmerge-stale"]);
    assert.equal(fs.existsSync(path.join(tmp, "xclaw-wt-stale")), false);
    assert.ok(fs.existsSync(path.join(tmp, "xclaw-wt-fresh")), "fresh kept");
    assert.ok(fs.existsSync(path.join(tmp, "unrelated-dir")), "foreign kept");
    assert.ok(fs.existsSync(referenced), "mission-referenced kept");
    assert.deepEqual(real.skippedReferenced, ["xclaw-wt-referenced"]);

    fs.rmSync(tmp, { recursive: true, force: true });
    fs.rmSync(cfgDir, { recursive: true, force: true });
  });
});
