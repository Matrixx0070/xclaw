import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  buildModelChain,
  shouldFailover,
} from "../src/providers/failover-router.mjs";

describe("failover-router", () => {
  it("buildModelChain orders primary then fallbacks", () => {
    const chain = buildModelChain(
      {
        agent: {
          model: "xai/grok-4.5",
          fallbackModels: ["openai/gpt-4o-mini", "anthropic/claude-sonnet-5"],
        },
      },
      {}
    );
    assert.equal(chain[0], "xai/grok-4.5");
    assert.ok(chain.includes("openai/gpt-4o-mini"));
    assert.ok(chain.includes("anthropic/claude-sonnet-5"));
  });

  it("buildModelChain dedupes", () => {
    const chain = buildModelChain({
      agent: {
        model: "xai/grok-4.5",
        fallbackModels: ["xai/grok-4.5", "openai/gpt-4o-mini"],
      },
    });
    assert.equal(chain.filter((x) => x === "xai/grok-4.5").length, 1);
  });

  it("shouldFailover on 429 and transient", () => {
    assert.equal(shouldFailover(Object.assign(new Error("rate"), { status: 429 })), true);
    assert.equal(shouldFailover(Object.assign(new Error("bad"), { status: 400 })), false);
    assert.equal(shouldFailover(Object.assign(new Error("no api key"), { status: 401 })), true);
  });
});

describe("failover half-open recovery (R11)", () => {
  const mkClient = (name, impl) => ({
    provider: { chat: impl, model: name, baseUrl: `https://${name}.test` },
    route: { modelRef: name, provider: name },
  });

  it("re-probes the primary after cooldown instead of staying demoted", async () => {
    const { createFailoverProvider } = await import("../src/providers/failover-router.mjs");
    let primaryHealthy = false;
    let primaryCalls = 0;
    const primary = mkClient("primary", async () => {
      primaryCalls++;
      if (!primaryHealthy) throw Object.assign(new Error("rate"), { status: 429 });
      return { text: "primary-ok" };
    });
    const fallback = mkClient("fallback", async () => ({ text: "fallback-ok" }));
    const { provider } = await createFailoverProvider(
      { agent: { model: "primary", fallbackModels: ["fallback"] } },
      { _clients: [primary, fallback], policy: { cooldownMs: 30 } }
    );

    // 1st call: primary fails → demoted to fallback
    assert.equal((await provider.chat({})).text, "fallback-ok");
    // Immediately after: still on fallback (inside cooldown), primary untouched
    const callsAfterDemote = primaryCalls;
    assert.equal((await provider.chat({})).text, "fallback-ok");
    assert.equal(primaryCalls, callsAfterDemote, "no probe inside cooldown");
    // After cooldown with primary healthy again → probe succeeds, back on primary
    primaryHealthy = true;
    await new Promise((r) => setTimeout(r, 40));
    assert.equal((await provider.chat({})).text, "primary-ok");
  });

  it("failed probe falls straight back to the fallback", async () => {
    const { createFailoverProvider } = await import("../src/providers/failover-router.mjs");
    const primary = mkClient("primary", async () => {
      throw Object.assign(new Error("rate"), { status: 429 });
    });
    const fallback = mkClient("fallback", async () => ({ text: "fallback-ok" }));
    const { provider } = await createFailoverProvider(
      { agent: { model: "primary", fallbackModels: ["fallback"] } },
      { _clients: [primary, fallback], policy: { cooldownMs: 10 } }
    );
    assert.equal((await provider.chat({})).text, "fallback-ok");
    await new Promise((r) => setTimeout(r, 15));
    // probe primary → fails again → lands on fallback, not an error
    assert.equal((await provider.chat({})).text, "fallback-ok");
  });
});
