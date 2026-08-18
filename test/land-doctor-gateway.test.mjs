import { describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

describe("land doctor + gateway", () => {
  it("doctor-land-all patch has singlePort + perf", () => {
    const p = fs.readFileSync(path.join(root, "patches/doctor-land-all.patch"), "utf8");
    assert.ok(p.includes("pushSinglePortChecks"));
    assert.ok(p.includes("pushPerfChecksEnsured"));
    assert.ok(p.includes("mergePerfIntoChecks"));
  });

  it("gateway-land-wires patch has live SSE + digest", () => {
    const p = fs.readFileSync(path.join(root, "patches/gateway-land-wires.patch"), "utf8");
    assert.ok(p.includes("createLiveStreamWriter"));
    assert.ok(p.includes("ensureApprovalDigestCronJob"));
  });

  it("land-doctor-gateway script exists", () => {
    assert.ok(fs.existsSync(path.join(root, "scripts/land-doctor-gateway.mjs")));
  });
});
