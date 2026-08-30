import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { createBrowserAssertTool } from "../src/tools/browser-tools.mjs";

describe("browser_assert", () => {
  it("MITM off is isError, not skipped success", async () => {
    const tool = createBrowserAssertTool({ cfg: {} });
    const out = await tool.execute({ host: "example.com" });
    assert.equal(out.isError, true);
    assert.match(out.content[0].text, /MITM disabled/);
  });
});
