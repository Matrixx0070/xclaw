import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

// S8 (Master Evolution Directive): stagnation escalates the MODEL instead of
// warning the same stuck one. The "strong" role existed in ROLES but no path
// ever selected it; the loop now routes the next N turns to it when the loop
// guard fires a stagnation warning.
const tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), "xclaw-esc-"));
const savedHome = process.env.HOME;
const savedState = process.env.XCLAW_STATE_DIR;

let runAgentLoop, selectRole;

before(async () => {
  process.env.HOME = tmpHome;
  process.env.XCLAW_STATE_DIR = tmpHome;
  ({ runAgentLoop } = await import("../src/agent/loop.mjs"));
  ({ selectRole } = await import("../src/providers/role-router.mjs"));
});

after(() => {
  process.env.HOME = savedHome;
  if (savedState === undefined) delete process.env.XCLAW_STATE_DIR;
  else process.env.XCLAW_STATE_DIR = savedState;
  fs.rmSync(tmpHome, { recursive: true, force: true });
});

describe("escalate-on-stuck (S8)", () => {
  it("selectRole routes to strong on escalate (act without a strong mapping)", () => {
    const cfgStrong = { agent: { roles: { act: "fake/act", strong: "fake/strong" } } };
    assert.equal(selectRole({ escalate: true, turn: 4 }, cfgStrong), "strong");
    assert.equal(selectRole({ turn: 4 }, cfgStrong), "act");
    const cfgNoStrong = { agent: { roles: { act: "fake/act" } } };
    assert.equal(selectRole({ escalate: true, turn: 4 }, cfgNoStrong), "act");
  });

  it("a stagnation warning escalates the following turns to the strong role", async () => {
    const rolesSeen = [];
    const events = [];
    let n = 0;
    // Router-shaped provider: the loop asks selectRoleForTurn per turn and
    // passes the answer as args.role — exactly the role-router contract.
    const cfg = {
      agent: {
        maxTurns: 8,
        persistTranscript: false,
        roles: { act: "fake/act", strong: "fake/strong" },
        escalateTurns: 3,
        // breaker soft-warning fires at 3 calls (progress still detected) —
        // that IS the stagnation warning; critical/hard ceiling stays away.
        loopGuard: { warningThreshold: 6, criticalThreshold: 9, globalCircuitBreakerThreshold: 3 },
      },
      tokens: { enabled: false, ledger: false },
      skills: { enabled: false },
      memory: { enabled: false },
      computer: { autoStart: false },
      security: { autoApprove: true },
      hooks: { log: false },
    };
    const provider = {
      providerName: "fake-router",
      model: "fake-act",
      modelRef: "fake/act",
      baseUrl: "http://127.0.0.1:1",
      selectRoleForTurn(ctx) {
        return selectRole(ctx, cfg);
      },
      async chat(args) {
        rolesSeen.push(args.role || "act");
        n += 1;
        if (n >= 5) {
          return { message: { role: "assistant", content: "done" }, finishReason: "stop" };
        }
        return {
          message: {
            role: "assistant",
            content: "",
            tool_calls: [
              {
                id: `c${n}`,
                type: "function",
                // identical every time — trips the repetition warning
                function: { name: "bash", arguments: JSON.stringify({ command: "true" }) },
              },
            ],
          },
          finishReason: "tool_calls",
        };
      },
    };
    const out = await runAgentLoop({
      cfg,
      provider,
      message: "spin",
      continuation: false,
      onEvent: (e) => {
        if (e.type === "router" && e.phase === "escalate") events.push(e);
      },
    });
    assert.ok(events.length >= 1, "escalate event emitted");
    assert.ok(
      rolesSeen.includes("strong"),
      `strong role reached the provider (saw: ${rolesSeen.join(",")})`
    );
    assert.equal(out.stopReason, "natural");
  });
});
