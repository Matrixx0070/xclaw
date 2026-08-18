import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { STOP_HELP, printStopHelp } from "../src/cli/stop-help.mjs";

describe("stop --help", () => {
  it("covers sign, dry-run, fire-drill", () => {
    assert.ok(STOP_HELP.includes("--sign"));
    assert.ok(STOP_HELP.includes("--dry-run"));
    assert.ok(STOP_HELP.includes("stop-fire-drill"));
    const lines = [];
    printStopHelp((s) => lines.push(s));
    assert.ok(lines.join("\n").includes("X-XClaw-Stop-Sig"));
  });
});
