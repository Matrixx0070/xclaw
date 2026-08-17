import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  executeBash,
  normalizeBashTimeoutSeconds,
} from "../src/computer/modules/bash-tool.mjs";

describe("xclaw_bash codes", () => {
  it("normalizes ms to seconds", () => {
    assert.equal(normalizeBashTimeoutSeconds(30000), 30);
    assert.equal(normalizeBashTimeoutSeconds(5), 5);
    assert.equal(normalizeBashTimeoutSeconds(180000), 120); // 180s ms → clamp 120
    assert.ok(normalizeBashTimeoutSeconds(9999) < 15); // 9999ms → ~10s
  });

  it("empty command code", async () => {
    const r = await executeBash({ command: "  " });
    assert.equal(r.code, "BASH_EMPTY_COMMAND");
  });

  it("success code", async () => {
    const r = await executeBash({ command: "echo hi", timeout: 10 });
    assert.equal(r.ok, true);
    assert.equal(r.code, "BASH_OK");
    assert.match(r.stdout, /hi/);
  });

  it("nonzero exit code", async () => {
    const r = await executeBash({ command: "exit 7", timeout: 10 });
    assert.equal(r.ok, false);
    assert.equal(r.exitCode, 7);
    assert.equal(r.code, "BASH_EXIT_NONZERO");
  });

  it("timeout code", async () => {
    const r = await executeBash({ command: "sleep 5", timeout: 1 });
    assert.equal(r.ok, false);
    assert.equal(r.timedOut, true);
    assert.equal(r.code, "BASH_TIMEOUT");
  });
});
