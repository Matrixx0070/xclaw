import { describe, it } from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { assertPatchLandedOrAppliable } from "./helpers/patch-state.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

describe("authorize-quota-job patch", () => {
  it("is landed in the tree or still applies cleanly", () => {
    assertPatchLandedOrAppliable(
      assert,
      root,
      path.join(root, "patches/authorize-quota-job.patch"),
      [["src/jobs/job.mjs", "receiptCollector"]]
    );
  });
});
