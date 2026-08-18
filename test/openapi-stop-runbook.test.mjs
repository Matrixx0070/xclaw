import { describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

describe("stop OpenAPI runbook", () => {
  it("documents dryRun, sign CLI, fire-drill", () => {
    const md = fs.readFileSync(path.join(root, "docs/STOP.md"), "utf8");
    assert.ok(md.includes("stop --sign"));
    assert.ok(md.includes("--dry-run"));
    assert.ok(md.includes("stop-fire-drill"));
    const yaml = fs.readFileSync(path.join(root, "docs/openapi-stop.yaml"), "utf8");
    assert.ok(yaml.includes("dryRun"));
    assert.ok(yaml.includes("stableStringify") || yaml.includes("canonical"));
    assert.ok(yaml.includes("/xclaw/stop"));
  });
});
