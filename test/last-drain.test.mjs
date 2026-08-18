import { describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { recordLastDrain, getLastDrain } from "../src/gateway/last-drain.mjs";
import { pushKillSwitchChecks } from "../src/cli/doctor-kill-switch.mjs";

describe("doctor last drain", () => {
  it("records and reports lastDrain", async () => {
    recordLastDrain({ sessionsKilled: 2, wsClosed: 1, sseClosed: 3 });
    assert.equal(getLastDrain().sessionsKilled, 2);
    const checks = [];
    await pushKillSwitchChecks((id, status, message, extra) => checks.push({ id, extra }));
    assert.ok(checks.some((c) => c.id === "security.killSwitch.lastDrain"));
    assert.ok(checks[0].extra.lastDrain);
  });

  it("persists to disk and reloads", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "xclaw-ld-"));
    recordLastDrain({ sessionsKilled: 4, wsClosed: 0, sseClosed: 1 }, { cfg: { paths: { configDir: dir } } });
    const fp = path.join(dir, "last-drain.json");
    assert.ok(fs.existsSync(fp));
    const disk = JSON.parse(fs.readFileSync(fp, "utf8"));
    assert.equal(disk.sessionsKilled, 4);
    fs.rmSync(dir, { recursive: true, force: true });
  });
});
