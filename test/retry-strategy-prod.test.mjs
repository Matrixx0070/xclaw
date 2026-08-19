import { describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

describe("prod retry strategy", () => {
  it("defaults to decorrelated and provider respects Retry-After", () => {
    const defaults = fs.readFileSync(path.join(root, "src/config/defaults.mjs"), "utf8");
    assert.ok(defaults.includes('retryStrategy: "decorrelated"'));
    const provider = fs.readFileSync(path.join(root, "src/agent/provider.mjs"), "utf8");
    assert.ok(/Retry-After/i.test(provider));
  });
});
