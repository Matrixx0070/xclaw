import { describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { BATCH4 } from "../scripts/land-batch4.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

describe("land-batch4", () => {
  it("includes doctor-ops and gateway-stop", () => {
    assert.equal(BATCH4.length, 4);
    assert.ok(BATCH4.some((e) => e.file.includes("doctor-ops-bundle")));
    assert.ok(BATCH4.some((e) => e.file.includes("gateway-stop-route")));
  });

  it("each patch exists", () => {
    for (const e of BATCH4) {
      assert.ok(fs.existsSync(path.join(root, e.file)), e.file);
    }
  });
});
