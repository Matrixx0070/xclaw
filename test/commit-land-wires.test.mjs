import { describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

describe("commit land wires patches", () => {
  it("doctor-perf-ensure patch has ensure + merge", () => {
    const p = fs.readFileSync(path.join(root, "patches/doctor-perf-ensure.patch"), "utf8");
    assert.ok(p.includes("pushPerfChecksEnsured"));
    assert.ok(p.includes("mergePerfIntoChecks"));
  });

  it("gateway-land-wires patch has digest + live streams", () => {
    const p = fs.readFileSync(path.join(root, "patches/gateway-land-wires.patch"), "utf8");
    assert.ok(p.includes("ensureApprovalDigestCronJob"));
    assert.ok(p.includes("createLiveStreamWriter"));
    assert.ok(p.includes('prefix: "agent"'));
  });
});
