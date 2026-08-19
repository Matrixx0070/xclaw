import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { missingAllowedTools } from "../src/agent/tool-filter.mjs";

const AVAILABLE = ["xclaw_bash", "xclaw_file_read", "xclaw_file_write", "xclaw_skill"];

describe("allowlisted tools that do not exist", () => {
  it("reports an allowlist entry with no matching tool", () => {
    // live case: the profile allowed xclaw_file_list, the tool never
    // materialised, and the model only found out mid-turn
    const out = missingAllowedTools(
      ["xclaw_bash", "bash", "xclaw_file_list", "list_dir"],
      AVAILABLE
    );
    assert.deepEqual(out, ["xclaw_file_list", "list_dir"]);
  });

  it("treats x and xclaw_x as one capability, so aliases are not a gap", () => {
    const out = missingAllowedTools(
      ["xclaw_bash", "bash", "file_read", "file_write", "xclaw_skill"],
      AVAILABLE
    );
    assert.deepEqual(out, []);
  });

  it("ignores wildcard patterns", () => {
    assert.deepEqual(missingAllowedTools(["mcp__*", "xclaw_*"], AVAILABLE), []);
  });

  it("returns nothing when everything resolves", () => {
    assert.deepEqual(missingAllowedTools(AVAILABLE, AVAILABLE), []);
  });

  it("is safe on empty or malformed input", () => {
    assert.deepEqual(missingAllowedTools([], AVAILABLE), []);
    assert.deepEqual(missingAllowedTools(undefined, undefined), []);
    assert.deepEqual(missingAllowedTools([null, "", 7], AVAILABLE), []);
  });

  it("reports every missing entry, not just the first", () => {
    const out = missingAllowedTools(["nope_one", "nope_two"], AVAILABLE);
    assert.deepEqual(out, ["nope_one", "nope_two"]);
  });
});
