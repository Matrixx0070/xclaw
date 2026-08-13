import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  parseModelRef,
  inferProviderFromModel,
  resolveProviderRoute,
  listProviders,
  listModels,
  getProvider,
} from "../src/providers/registry.mjs";

describe("provider registry", () => {
  it("parses provider/model refs", () => {
    assert.deepEqual(parseModelRef("xai/grok-4.3"), { provider: "xai", model: "grok-4.3" });
    assert.deepEqual(parseModelRef("openai/gpt-4o-mini"), {
      provider: "openai",
      model: "gpt-4o-mini",
    });
    // openrouter-style model id should not steal provider
    const bare = parseModelRef("openai/gpt-4o-mini");
    assert.equal(bare.provider, "openai");
  });

  it("infers provider from model prefix", () => {
    assert.equal(inferProviderFromModel("grok-4.3"), "xai");
    assert.equal(inferProviderFromModel("gpt-4o"), "openai");
    assert.equal(inferProviderFromModel("claude-sonnet-4-5"), "anthropic");
  });

  it("resolves xai route defaults", () => {
    const r = resolveProviderRoute({ agent: { model: "xai/grok-4.3" } });
    assert.equal(r.provider, "xai");
    assert.equal(r.model, "grok-4.3");
    assert.ok(r.baseUrl.includes("api.x.ai"));
    assert.equal(r.modelRef, "xai/grok-4.3");
  });

  it("resolves custom provider from cfg", () => {
    const cfg = {
      models: {
        providers: {
          lmstudio: {
            name: "LM Studio",
            baseUrl: "http://127.0.0.1:1234/v1",
            defaultModel: "my-local",
            models: [{ id: "my-local", name: "Local" }],
          },
        },
      },
      agent: { provider: "lmstudio", model: "my-local" },
    };
    const r = resolveProviderRoute(cfg);
    assert.equal(r.provider, "lmstudio");
    assert.equal(r.baseUrl, "http://127.0.0.1:1234/v1");
    assert.equal(r.model, "my-local");
    const all = listProviders(cfg);
    assert.ok(all.lmstudio);
    assert.equal(all.lmstudio.custom, true);
  });

  it("lists models with refs", () => {
    const rows = listModels({});
    assert.ok(rows.some((m) => m.ref === "xai/grok-4.3"));
    assert.ok(rows.some((m) => m.provider === "openai"));
  });

  it("lists many models per major provider", () => {
    const rows = listModels({});
    const by = {};
    for (const r of rows) {
      by[r.provider] = (by[r.provider] || 0) + 1;
    }
    assert.ok(by.xai >= 6, `xai models ${by.xai}`);
    assert.ok(by.openai >= 6, `openai ${by.openai}`);
    assert.ok(by.anthropic >= 5, `anthropic ${by.anthropic}`);
    assert.ok(by.google >= 4, `google ${by.google}`);
    assert.ok(by.mistral >= 5, `mistral ${by.mistral}`);
    assert.ok(by.groq >= 5, `groq ${by.groq}`);
    assert.ok(by.ollama >= 8, `ollama ${by.ollama}`);
  });

  it("lists all builtin providers", () => {
    const all = listProviders({});
    for (const id of ["xai", "openai", "anthropic", "google", "deepseek", "groq", "mistral", "openrouter", "ollama"]) {
      assert.ok(all[id], `missing provider ${id}`);
    }
  });

  it("compatible uses XCLAW_API_BASE", () => {
    const prev = process.env.XCLAW_API_BASE;
    process.env.XCLAW_API_BASE = "http://10.0.0.5:9000/v1";
    const r = resolveProviderRoute({ agent: { provider: "compatible" } });
    assert.equal(r.baseUrl, "http://10.0.0.5:9000/v1");
    if (prev === undefined) delete process.env.XCLAW_API_BASE;
    else process.env.XCLAW_API_BASE = prev;
  });

  it("getProvider falls back to compatible", () => {
    const p = getProvider({}, "nope-unknown");
    assert.equal(p.id, "compatible");
  });
});

describe("ollama local vs ollama-cloud (two entries)", () => {
  it("ollama → local daemon, ollama-cloud → ollama.com", async () => {
    const { resolveProviderRouteAsync, BUILTIN_PROVIDERS } = await import("../src/providers/registry.mjs");
    assert.ok(BUILTIN_PROVIDERS["ollama-cloud"], "ollama-cloud provider exists");
    const local = await resolveProviderRouteAsync({ paths:{configDir:"/tmp/xclaw-none"} }, { provider:"ollama", model:"llama3.2" });
    assert.match(local.baseUrl, /127\.0\.0\.1:11434/);
    const cloud = await resolveProviderRouteAsync({ paths:{configDir:"/tmp/xclaw-none"} }, { provider:"ollama-cloud", model:"gpt-oss:120b" });
    assert.match(cloud.baseUrl, /ollama\.com/);
  });
});

describe("nvidia provider (free NIM catalog)", () => {
  it("resolves the integrate.api.nvidia.com endpoint", async () => {
    const { resolveProviderRouteAsync, BUILTIN_PROVIDERS } = await import("../src/providers/registry.mjs");
    assert.ok(BUILTIN_PROVIDERS.nvidia, "nvidia provider exists");
    assert.equal(BUILTIN_PROVIDERS.nvidia.envKey, "NVIDIA_API_KEY");
    const r = await resolveProviderRouteAsync({ paths:{configDir:"/tmp/xclaw-none"} }, { provider:"nvidia", model:"meta/llama-3.3-70b-instruct" });
    assert.match(r.baseUrl, /integrate\.api\.nvidia\.com/);
    assert.equal(r.api, "openai-completions");
  });
});
