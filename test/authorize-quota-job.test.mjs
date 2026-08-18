import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { authorizeQuotaPreflight } from "../src/security/authorize-quota.mjs";

describe("authorize quota job collector", () => {
  it("stamps quotaEscalate when job is passed", async () => {
    const job = {};
    const r = await authorizeQuotaPreflight(
      "write_file",
      { path: "x.txt", content: "hello-world-quota" },
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
});
