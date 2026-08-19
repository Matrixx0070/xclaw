import { describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

describe("fire-drill post_offline guard", () => {
  it("source rejects missing step", () => {
    const src = fs.readFileSync(path.join(root, "src/eval/stop-fire-drill.mjs"), "utf8");
    assert.ok(src.includes("post_offline step missing"));
    assert.ok(src.includes("fireDrillPostOffline"));
  });
});
