import { describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

describe("openapi stop + health", () => {
  it("documents /stop and health.stop", () => {
    const spec = fs.readFileSync(path.join(root, "docs/openapi-stop.yaml"), "utf8");
    assert.ok(spec.includes("/stop:"));
    assert.ok(spec.includes("authMethod"));
    assert.ok(spec.includes("X-XClaw-Stop-Sig"));
    const api = fs.readFileSync(path.join(root, "docs/API.md"), "utf8");
    assert.ok(api.includes("`/stop`"));
    const stop = fs.readFileSync(path.join(root, "docs/STOP.md"), "utf8");
    assert.ok(stop.includes("kill-switch"));
  });
});
