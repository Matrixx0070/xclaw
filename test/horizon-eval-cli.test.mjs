import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { evalMain } from "../src/eval/cli.mjs";

describe("horizon eval cli", () => {
  it("xclaw eval horizon --offline exits ok", async () => {
    const r = await evalMain(["horizon", "--offline"]);
    assert.equal(r.ok, true);
  });
});
