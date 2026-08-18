import { describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

describe("recallMemory expand wire", () => {
  it("patch calls expandRecallHits", () => {
    const p = fs.readFileSync(path.join(root, "patches/recall-expand-wire.patch"), "utf8");
    assert.ok(p.includes("expandRecallHits"));
    assert.ok(p.includes("provenance"));
  });
});
