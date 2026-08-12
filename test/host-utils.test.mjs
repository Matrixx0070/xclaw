import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { createHostUtilsTools } from "../src/tools/host-utils.mjs";

describe("host utils", () => {
  it("lists three tools", () => {
    const t = createHostUtilsTools();
    assert.deepEqual(t.map((x) => x.name).sort(), [
      "file_type",
      "host_capabilities",
      "markitdown",
    ]);
  });

  it("host_capabilities reports bins", async () => {
    const tool = createHostUtilsTools().find((t) => t.name === "host_capabilities");
    const r = await tool.execute({});
    assert.match(r.content[0].text, /ffmpeg|python3|node/);
  });
});
