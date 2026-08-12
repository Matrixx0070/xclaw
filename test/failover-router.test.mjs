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
