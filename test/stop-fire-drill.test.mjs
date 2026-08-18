import { describe, it } from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { runStopFireDrill } from "../src/eval/stop-fire-drill.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

describe("single-port stop fire-drill", () => {
  it("passes HTTP + HMAC canonical + WS + TLS + dry-run", async () => {
    const r = await runStopFireDrill({ root });
    if (!r.ok) {
      console.error(JSON.stringify(r, null, 2));
    }
    assert.equal(r.ok, true, `failed: ${(r.failed || []).join(",")}`);
    const canon = r.steps.find((s) => s.name === "http_hmac_canonical");
    assert.ok(canon);
    assert.equal(canon.authMethod, "hmac");
  });
});
