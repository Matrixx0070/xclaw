import { describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  RELEASE_GATE_STRICT_EXTRA_TESTS,
  listStrictExtraTests,
} from "../src/ci/release-gate-strict-extras.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

describe("release-gate strict extras", () => {
  it("includes receipt-metrics and dual-preflight", () => {
    assert.ok(RELEASE_GATE_STRICT_EXTRA_TESTS.some((f) => f.includes("receipt-metrics")));
    assert.ok(RELEASE_GATE_STRICT_EXTRA_TESTS.some((f) => f.includes("dual-preflight")));
  });

  it("listed files exist", () => {
    const files = listStrictExtraTests(root);
    assert.equal(files.length, RELEASE_GATE_STRICT_EXTRA_TESTS.length);
    for (const f of files) assert.ok(fs.existsSync(path.join(root, f)));
  });
});
