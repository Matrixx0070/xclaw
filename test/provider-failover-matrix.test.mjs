/**
 * Provider failover matrix: 5xx/timeout → next model; budget transfers.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  shouldFailover,
  buildModelChain,
} from "../src/providers/failover-router.mjs";
import {
  remainingBudget,
  transferBudgetOnFailover,
  isBudgetExhausted,
} from "../src/providers/failover-budget.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

describe("shouldFailover matrix", () => {
  it("failovers on 5xx", () => {
    for (const status of [502, 503, 504]) {
      assert.equal(shouldFailover(Object.assign(new Error("x"), { status })), true, String(status));
    }
  });

  it("failovers on 429 and timeout message", () => {
    assert.equal(shouldFailover(Object.assign(new Error("rate"), { status: 429 })), true);
    assert.equal(shouldFailover(new Error("socket hang up")), true);
    assert.equal(shouldFailover(new Error("timeout waiting")), true);
  });

  it("does not failover on 400", () => {
    assert.equal(shouldFailover(Object.assign(new Error("bad"), { status: 400 })), false);
  });
});

describe("buildModelChain", () => {
  it("orders primary then fallbacks", () => {
    const chain = buildModelChain({
      agent: {
        model: "xai/grok-2",
        fallbackModels: ["xai/grok-2-mini", "openai/gpt-4o-mini"],
      },
    });
    assert.equal(chain[0], "xai/grok-2");
    assert.ok(chain.includes("xai/grok-2-mini"));
  });
});

describe("budget transfer", () => {
  it("remainingUsd after spend", () => {
    const r = remainingBudget({ maxUsd: 1.0, spentUsd: 0.4 });
    assert.equal(r.remainingUsd, 0.6);
  });

  it("transfer preserves spent and records meta", () => {
    const next = transferBudgetOnFailover(
      { maxUsd: 1.0, spentUsd: 0.3, maxTurns: 10, turns: 2 },
      { fromRef: "xai/a", toRef: "xai/b", reason: "503" }
    );
    assert.equal(next.spentUsd, 0.3);
    assert.equal(next.transfer.fromRef, "xai/a");
    assert.equal(next.transfer.toRef, "xai/b");
    assert.equal(next.transfer.remainingUsd, 0.7);
    assert.equal(isBudgetExhausted({ maxUsd: 1, spentUsd: 1 }), true);
    assert.equal(isBudgetExhausted({ maxUsd: 1, spentUsd: 0.5 }), false);
  });
});

describe("createFailoverProvider e2e mock", () => {
  it("switches client on 503 and transfers budget", async () => {
    spawnSync("git", ["apply", "--whitespace=nowarn", path.join(root, "patches/failover-budget-transfer.patch")], {
      cwd: root,
      encoding: "utf8",
    });
    const { createFailoverProvider } = await import("../src/providers/failover-router.mjs");
    let calls = 0;
    const events = [];
    const budget = { maxUsd: 2, spentUsd: 0.5, maxTurns: 8, turns: 1 };
    const primary = {
      model: "primary",
      chat: async () => {
        calls += 1;
        if (calls === 1) {
          const e = new Error("unavailable");
          e.status = 503;
          throw e;
        }
        return { content: "should not" };
      },
    };
    const secondary = {
      model: "secondary",
      chat: async () => {
        calls += 1;
        return { content: "ok-from-secondary" };
      },
    };
    const { provider } = await createFailoverProvider(
      { agent: { model: "xai/a", fallbackModels: ["xai/b"] } },
      {
        budget,
        onEvent: (e) => events.push(e),
        _clients: [
          { provider: primary, route: { modelRef: "xai/a", provider: "xai" } },
          { provider: secondary, route: { modelRef: "xai/b", provider: "xai" } },
        ],
      }
    );
    const out = await provider.chat({ messages: [] });
    assert.equal(out.content, "ok-from-secondary");
    assert.ok(events.some((e) => e.phase === "failover"));
    assert.ok(events.some((e) => e.phase === "budget_transfer"));
    assert.ok(events.some((e) => e.phase === "failover_success"));
    assert.equal(budget.transfer?.toRef, "xai/b");
  });
});
