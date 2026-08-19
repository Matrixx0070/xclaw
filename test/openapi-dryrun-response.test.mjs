import { describe, it } from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { checkOpenapiStopContract } from "../src/ci/openapi-stop-contract.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

describe("openapi x-dry-run-response", () => {
  it("is required by contract", () => {
    const r = checkOpenapiStopContract(root);
    assert.equal(r.ok, true, (r.missing || []).join(","));
    assert.ok(!r.missing?.includes("x-dry-run-response"));
  });
});
