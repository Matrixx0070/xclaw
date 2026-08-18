import { describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

describe("ship patches quota + redaction", () => {
  it("lists authorize-quota, ws-redact, sse-redact", () => {
    const src = fs.readFileSync(path.join(root, "scripts/apply-ship-patches.mjs"), "utf8");
    assert.ok(src.includes("authorize-quota.patch"));
    assert.ok(src.includes("ws-redact-emit.patch"));
    assert.ok(src.includes("sse-redact.patch"));
    assert.ok(src.includes("authorizeQuotaPreflight"));
  });

  it("patch files exist", () => {
    for (const f of [
      "authorize-quota.patch",
      "ws-redact-emit.patch",
      "sse-redact.patch",
    ]) {
      assert.ok(fs.existsSync(path.join(root, "patches", f)), f);
    }
  });
});
