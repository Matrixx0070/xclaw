import { describe, it } from "node:test";
import assert from "node:assert/strict";
import os from "node:os";
import fs from "node:fs";
import path from "node:path";
import { sh, shArgs, SH_MAX_OUTPUT } from "../src/missions/run-cmd.mjs";

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "xclaw-runcmd-"));

describe("mission command runner", () => {
  it("a timeout kills the whole process group, not just the shell", async () => {
    const t0 = Date.now();
    const r = await sh("sleep 5 & echo hi", dir, 200);
    const ms = Date.now() - t0;
    assert.ok(
      ms < 1500,
      `timeout did not stop the command: resolved after ${ms}ms (a surviving grandchild holds the stdout pipe open, so 'close' waits for it)`
    );
    assert.match(r.output, /hi/);
  });

  it("says so when it killed a command for running too long", async () => {
    const r = await sh("sleep 5 & echo hi", dir, 200);
    assert.match(
      r.output,
      /timed out after 200ms/,
      "a killed command resolved code 1 with partial output, indistinguishable from a genuine failure"
    );
    assert.notEqual(r.code, 0);
  });

  it("kills the process group for argv-style commands too", async () => {
    const t0 = Date.now();
    await shArgs("bash", ["-c", "sleep 5 & echo hi"], dir, 200);
    assert.ok(Date.now() - t0 < 1500, "shArgs carries the same defect");
  });

  it("still returns exit code and output for commands that finish", async () => {
    assert.deepEqual(await sh("printf ok", dir, 5000), { code: 0, output: "ok" });
    const bad = await sh("printf boom >&2; exit 3", dir, 5000);
    assert.equal(bad.code, 3);
    assert.match(bad.output, /boom/);
    const argv = await shArgs("printf", ["fine"], dir, 5000);
    assert.deepEqual(argv, { code: 0, output: "fine" });
  });

  it("keeps the tail of a large shell output and does not grow unbounded", async () => {
    const r = await sh(`for i in $(seq 1 4000); do printf '0123456789'; done; printf END`, dir, 20000);
    assert.equal(r.code, 0);
    assert.ok(r.output.length <= SH_MAX_OUTPUT, `output grew to ${r.output.length}`);
    assert.ok(r.output.endsWith("END"));
  });
});
