import { describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { refreshAuthBeforeCostPreflight } from "../src/tokens/cost-preflight-auth.mjs";
import { loadAuthRefreshStatus } from "../src/tokens/auth-refresh-status.mjs";

describe("cost preflight always records auth status", () => {
  it("records on skip path", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "xclaw-ars-"));
    const cfg = {
      paths: { configDir: dir },
      cost: { refreshAuthBeforeBudget: false },
    };
    await refreshAuthBeforeCostPreflight(cfg);
    const st = await loadAuthRefreshStatus(cfg);
    assert.ok(st);
    assert.equal(st.skipped, true);
    assert.equal(st.reason, "disabled");
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it("records when ensureFresh always fails softly", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "xclaw-ars2-"));
    const cfg = { paths: { configDir: dir } };
    await refreshAuthBeforeCostPreflight(cfg, {
      apps: ["xai"],
      ensureFresh: async () => ({ ok: false, error: "no token" }),
    });
    const st = await loadAuthRefreshStatus(cfg);
    assert.ok(st);
    assert.equal(st.results?.[0]?.ok, false);
    fs.rmSync(dir, { recursive: true, force: true });
  });
});
