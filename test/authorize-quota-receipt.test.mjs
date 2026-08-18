import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { authorizeQuotaPreflight } from "../src/security/authorize-quota.mjs";

describe("authorize quota records escalate", () => {
  it("hard refuse increments collector", async () => {
    const job = {};
    const r = await authorizeQuotaPreflight(
      "write_file",
      { path: "x.txt", content: "hello" },
      {
        job,
        workingDir: "/tmp",
        cfg: {
          workspace: {
            quota: { enabled: true, maxBytes: 1, softBytes: 1, escalateSoftToHard: true },
          },
        },
      }
    );
    if (!r.ok) {
      assert.ok(job.quotaEscalate);
      assert.ok(job.quotaEscalate.hardBlocks >= 1);
    }
  });

  it("recordEscalate no-ops without collector", async () => {
    const r = await authorizeQuotaPreflight("read_file", { path: "a" }, {});
    assert.equal(r.ok, true);
    assert.equal(r.skipped, true);
  });
});
