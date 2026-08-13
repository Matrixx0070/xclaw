import { describe, it } from "node:test";
import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";
import { createImageTools } from "../src/tools/image-tools.mjs";

describe("image tool credential resolution (provider profile, not env)", () => {
  it("with no env + no credential → helpful error pointing at `xclaw providers`", async () => {
    const saved = { ...process.env };
    try {
      delete process.env.XAI_API_KEY;
      delete process.env.XCLAW_API_KEY;
      const tools = createImageTools({ workingDir: path.join(os.tmpdir(), "xclaw-img-cred"), cfg: { paths: { configDir: "/tmp/xclaw-none-img" } } });
      const gen = tools.find((t) => t.name === "generate_image");
      const r = await gen.execute({ prompt: "x" });
      assert.equal(Boolean(r.isError), true);
      const msg = r.content?.[0]?.text || "";
      assert.match(msg, /xclaw providers/, "error should guide to the provider credential, not XAI_API_KEY env");
      assert.doesNotMatch(msg, /XAI_API_KEY not set/, "old env-only message removed");
    } finally {
      process.env = saved;
    }
  });

  it("createImageTools threads cfg to the generate/edit tools", async () => {
    const fs = await import("node:fs/promises");
    const src = await fs.readFile(new URL("../src/tools/image-tools.mjs", import.meta.url), "utf8");
    assert.match(src, /resolveProviderToken\(cfg, "xai"/, "resolves xai via the provider store");
    assert.match(src, /createGenerateImageTool\(\{ workingDir, cfg \}\)/);
  });
});
