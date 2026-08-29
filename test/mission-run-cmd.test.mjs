import { describe, it } from "node:test";
import assert from "node:assert/strict";
import os from "node:os";
import fs from "node:fs";
import path from "node:path";
import { sh, shArgs, runProcess, SH_MAX_OUTPUT } from "../src/missions/run-cmd.mjs";

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

  it("does not hand the gateway's secrets to a verification command", async () => {
    // Every agent-driven shell in xclaw goes through buildToolEnv; mission
    // verification shelled out with the gateway's full process.env, so a
    // verify command — model-influenced via package.json, operator-supplied via
    // cfg.self.verifyCommands, caller-supplied via POST /missions — read every
    // credential the gateway was started with.
    process.env.XCLAW_TEST_FAKE_API_KEY = "not-a-real-key";
    process.env.XCLAW_TEST_FAKE_PLAIN = "plain-value";
    try {
      const r = await sh("printenv", dir, 10_000);
      assert.doesNotMatch(
        r.output,
        /XCLAW_TEST_FAKE_API_KEY/,
        "a verify command inherited a secret-named var from the gateway process"
      );
      assert.match(
        r.output,
        /XCLAW_TEST_FAKE_PLAIN/,
        "the policy stripped a non-secret var, which would break real verifications"
      );
    } finally {
      delete process.env.XCLAW_TEST_FAKE_API_KEY;
      delete process.env.XCLAW_TEST_FAKE_PLAIN;
    }
  });

  it("honours the operator's env policy rather than a hardcoded one", async () => {
    process.env.XCLAW_TEST_FAKE_API_KEY = "not-a-real-key";
    try {
      const r = await runProcess("printenv", [], {
        cwd: dir,
        timeoutMs: 10_000,
        cfg: { security: { bashEnv: "inherit" } },
      });
      assert.match(
        r.output,
        /XCLAW_TEST_FAKE_API_KEY/,
        "security.bashEnv is not reaching the spawn; the policy is hardcoded"
      );
    } finally {
      delete process.env.XCLAW_TEST_FAKE_API_KEY;
    }
  });

  it("keeps the tail of a large shell output and does not grow unbounded", async () => {
    const r = await sh(`for i in $(seq 1 4000); do printf '0123456789'; done; printf END`, dir, 20000);
    assert.equal(r.code, 0);
    assert.ok(r.output.length <= SH_MAX_OUTPUT, `output grew to ${r.output.length}`);
    assert.ok(r.output.endsWith("END"));
  });
});
