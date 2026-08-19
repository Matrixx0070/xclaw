import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  hashLines,
  idempotentS3Key,
  noteIdempotentKey,
  getIdempotentHitTotal,
} from "../src/cluster/audit-s3-idempotent.mjs";
import { putS3WithRetry } from "../src/cluster/audit-s3.mjs";

describe("idempotent s3 key", () => {
  it("same range+lines → same key", () => {
    const lines = ['{"a":1}', '{"b":2}'];
    const k1 = idempotentS3Key({ account: "acme", from: 0, to: 2, lines });
    const k2 = idempotentS3Key({ account: "acme", from: 0, to: 2, lines });
    assert.equal(k1, k2);
    assert.match(k1, /^audit\/acme\/0-2-[a-f0-9]{12}\.json$/);
    assert.equal(hashLines(lines).length, 12);
  });
  it("two puts same range → same key", async () => {
    const lines = ["line-a", "line-b"];
    const bundle = { header: { from: 1, to: 3, count: 2 }, lines };
    const keys = [];
    const put = async ({ key }) => {
      keys.push(key);
    };
    const cfg = { cluster: { auditAccount: "x", s3Retries: 1 } };
    await putS3WithRetry(put, bundle, cfg);
    await putS3WithRetry(put, bundle, cfg);
    assert.equal(keys[0], keys[1]);
    noteIdempotentKey(keys[0], { hit: true });
    assert.ok(getIdempotentHitTotal() >= 1);
  });
});
