import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { listNativeTools } from "../src/computer/native-tools.mjs";
import { formatCapabilityBanner, resolveReach } from "../src/agent/capability-reach.mjs";
import { buildAutonomyAppendix, resolveAutonomyPolicy } from "../src/agent/autonomy-policy.mjs";
import { OPENCLAW_TO_XCLAW } from "../src/tools/aliases/openclaw-map.mjs";
import { isParallelSafe } from "../src/agent/tool-concurrency.mjs";

describe("CUA agent surface", () => {
  it("lists xclaw_computer_act as native tool", () => {
    const names = listNativeTools().map((t) => t.name);
    assert.ok(names.includes("xclaw_computer_act"));
    assert.ok(names.includes("xclaw_browser_tab"));
  });

  it("capability banner includes CUA policy", () => {
    const b = formatCapabilityBanner(resolveReach({}));
    assert.match(b, /CUA policy/);
    assert.match(b, /xclaw_computer_act/);
  });

  it("autonomy appendix mentions observe before act", () => {
    const a = buildAutonomyAppendix(resolveAutonomyPolicy({}));
    assert.match(a, /xclaw_browser_tab observe/);
  });

  it("aliases map computer_act", () => {
    assert.equal(OPENCLAW_TO_XCLAW.computer_act, "xclaw_computer_act");
  });

  it("computer_act is serial not parallel-safe", () => {
    assert.equal(isParallelSafe("xclaw_computer_act"), false);
  });
});
