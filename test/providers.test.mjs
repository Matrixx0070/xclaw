
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { resolveProviderPack, listProviderPresets } from "../src/config/providers.mjs";

describe("provider pack", () => {
  it("lists presets", () => {
    const list = listProviderPresets();
    assert.ok(list.some((p) => p.id === "xai"));
    assert.ok(list.some((p) => p.id === "openai"));
  });
  it("resolves xai for grok model", () => {
    const p = resolveProviderPack({ agent: { model: "grok-4.3" } });
    assert.equal(p.id, "xai");
    assert.ok(p.baseUrl.includes("x.ai"));
  });
  it("respects XCLAW_PROVIDER", () => {
    process.env.XCLAW_PROVIDER = "openai";
    const p = resolveProviderPack({ agent: { model: "gpt-4o-mini" } });
    assert.equal(p.id, "openai");
    delete process.env.XCLAW_PROVIDER;
  });
});
