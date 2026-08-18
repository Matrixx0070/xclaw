import { describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { BATCH3 } from "../scripts/land-batch3.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

describe("land-batch3", () => {
  it("has ten wires including tls-stop-proxy", () => {
    assert.equal(BATCH3.length, 10);
    assert.ok(BATCH3.some((e) => e.file.includes("tls-stop-proxy")));
  });

  it("each patch exists", () => {
    for (const e of BATCH3) {
      assert.ok(fs.existsSync(path.join(root, e.file)), e.file);
    }
  });
});
