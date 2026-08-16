import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  OPENCLAW_TO_XCLAW,
  adaptWildClawPrompt,
} from "../src/tools/aliases/openclaw-map.mjs";

describe("Wave A openclaw aliases", () => {
  it("maps exec to xclaw_bash", () => {
    assert.equal(OPENCLAW_TO_XCLAW.exec, "xclaw_bash");
    assert.equal(OPENCLAW_TO_XCLAW.web_search, "xclaw_web_search");
  });

  it("rewrites tmp_workspace paths", () => {
    const p = adaptWildClawPrompt("Save to /tmp_workspace/results/out.md");
    assert.match(p, /\.\/results\/out\.md/);
    assert.match(p, /xclaw_bash/);
  });
});
