import { describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

describe("WS hub receives cfg", () => {
  it("patch passes cfg into attachWebSocketHub", () => {
    const patch = fs.readFileSync(path.join(root, "patches/ws-hub-pass-cfg.patch"), "utf8");
    assert.ok(patch.includes("cfg,"));
    assert.ok(patch.includes("attachWebSocketHub"));
  });
});
