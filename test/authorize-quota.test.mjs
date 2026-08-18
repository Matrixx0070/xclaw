import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { authorizeQuotaPreflight } from "../src/security/authorize-quota.mjs";

describe("authorize quota preflight", () => {
  let tmp;
  before(async () => {
    tmp = await fs.mkdtemp(path.join(os.tmpdir(), "xclaw-aq-"));
    await fs.writeFile(path.join(tmp, "a.txt"), "x");
  });
  after(async () => {
    await fs.rm(tmp, { recursive: true, force: true });
  });

  it("skips read tools", async () => {
    const r = await authorizeQuotaPreflight("xclaw_file_read", { path: "a" });
    assert.equal(r.ok, true);
    assert.equal(r.skipped, true);
  });

  it("blocks write over hard quota", async () => {
    const r = await authorizeQuotaPreflight(
      "xclaw_file_write",
      { path: "b.txt", content: "hello world" },
      {
        workingDir: tmp,
        cfg: { workspace: { quota: { maxBytes: 2, maxFiles: 100 } } },
      }
    );
    assert.equal(r.ok, false);
    assert.equal(r.reason, "WORKSPACE_QUOTA_EXCEEDED");
  });

  it("allows write under quota", async () => {
    const r = await authorizeQuotaPreflight(
      "xclaw_file_write",
      { path: "c.txt", content: "ok" },
      {
        workingDir: tmp,
        cfg: { workspace: { quota: { maxBytes: 10_000_000, maxFiles: 10_000 } } },
      }
    );
    assert.equal(r.ok, true);
  });
});
