/**
 * The gateway belt: browser tab calls pass through the fabric hooks, and a hook
 * refusal must reach the model INSTEAD of the call, not alongside it.
 *
 * Sixth instalment of the mutation sweep behind loop-toctou-enforcement
 * (v3.180.0), loop-allowtools-enforcement (v3.180.1), loop-stage-enforcement /
 * loop-guard-enforcement (v3.180.2) and loop-budget-enforcement (v3.182.0).
 * This block was mutated to a no-op on 2026-08-25 and the full suite stayed
 * green at 3032 tests:
 *
 *     Y: if (false && hr && hr.ok === false) { ... } else { toolRouter.dispatch(...) }
 *
 * Nothing else enforces this. assertJsCodeAllowed is called from exactly one
 * place, src/browser/hooks.mjs, and the bundled engine has no jsCode policy of
 * its own (JSCODE_MOTOR_PATTERN: 0 hits in src/computer/xclaw-server.mjs). With
 * the short-circuit deleted, a motor-pattern jsCode aimed at a live tab is
 * dispatched and runs against the page — the synthesized-click bypass the hook
 * exists to close.
 *
 * It still LOOKS refused under the mutation, which is the trap: these cases
 * target a tab that cannot exist, so the mutant's dispatch comes back with the
 * engine's "Failed to initialize browser or tab" instead. "The call failed" is
 * therefore not a discriminating assertion. The `[xclaw-hooks] ` prefix is:
 * only this block writes it, so the tests below assert on it exactly.
 *
 * Nor is `!started` usable here, as it was for the quota circuit: the belt runs
 * AFTER onEvent({type:"tool",phase:"start"}), so a tool/start event is emitted
 * either way.
 *
 * Both directions: the mirror sends the SAME tool with the SAME tabId under the
 * SAME policy mode and changes only the jsCode, from a motor pattern to one the
 * hook permits; it must reach dispatch, proven by the tool's own typed
 * InputValidationError coming back with no `[xclaw-hooks]` prefix. Without the
 * mirror, a belt that refused every browser call would pass.
 *
 * CI-safe, per the house rule in test/browser-tab-native-cdp.test.mjs: both
 * cases return before any Chrome or network work. The refusal never reaches the
 * computer plane at all; the mirror reaches it and is rejected by the tool's
 * argument schema, which runs before the browser is touched. That is also why
 * the mirror's jsCode is an invalid type rather than a valid read expression —
 * `document.title` on an unknown tab would go on to initialise a browser.
 *
 * Levers: XCLAW_JSCODE_MODE=read is set directly rather than via
 * XCLAW_FABRIC_ENFORCE, which would additionally require tab leases and start
 * a lease heartbeat timer that outlives the test. The role is pinned so the
 * pair differs in exactly one field.
 *
 * This header used to say the belt's fail-OPEN catch had "no behaviour to pin,
 * because today's hooks return typed results and do not throw". That was true
 * of the two entry points and wrong about the graph beneath them — beforeInput
 * → requireTabLease → acquireTabLease → fs.mkdir(fabricRoot) throws, and the
 * catch dispatched the call anyway. Reproduced and fixed on 2026-08-25
 * (v3.186.0); the coverage lives in test/loop-belt-failclosed.test.mjs. Read
 * the transitive call graph, not the signature of the function you call.
 */
import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), "xclaw-belt-enf-"));
const saved = {};

let runAgentLoop;

/** A tab that cannot exist, so nothing can be driven even if dispatch happens. */
const TAB = "xclaw-belt-enforcement-no-such-tab";

before(async () => {
  for (const k of [
    "HOME",
    "XCLAW_STATE_DIR",
    "XCLAW_FABRIC_DIR",
    "XCLAW_JSCODE_MODE",
    "XCLAW_AGENT_ROLE",
    "XCLAW_FABRIC_ENFORCE",
  ]) {
    saved[k] = process.env[k];
  }
  process.env.HOME = tmpHome;
  process.env.XCLAW_STATE_DIR = tmpHome;
  process.env.XCLAW_FABRIC_DIR = path.join(tmpHome, "fabric");
  process.env.XCLAW_JSCODE_MODE = "read";
  process.env.XCLAW_AGENT_ROLE = "actor";
  delete process.env.XCLAW_FABRIC_ENFORCE;
  ({ runAgentLoop } = await import("../src/agent/loop.mjs"));
});

after(() => {
  for (const [k, v] of Object.entries(saved)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
  fs.rmSync(tmpHome, { recursive: true, force: true });
});

function workspace(label) {
  return fs.realpathSync(fs.mkdtempSync(path.join(tmpHome, `${label}-`)));
}

function cfg(dir) {
  return {
    agent: { maxTurns: 3, persistTranscript: false },
    tokens: { enabled: false, ledger: false },
    skills: { enabled: false },
    memory: { enabled: false },
    computer: { autoStart: false },
    hooks: { log: false },
    security: { autoApprove: true, criticalOverride: "legacy" },
    paths: { configDir: dir },
    cost: { dailyHardUsd: 100, dailySoftUsd: 100 },
  };
}

/** One browser_tab call, then a text finish; captures the model's next input. */
function browserProvider(jsCode) {
  const p = {
    calls: 0,
    seen: null,
    providerName: "fake",
    model: "grok-4",
    modelRef: "grok-4",
    baseUrl: "http://127.0.0.1:1",
    async chat(req) {
      p.calls += 1;
      if (p.calls === 1) {
        return {
          message: {
            role: "assistant",
            content: "",
            tool_calls: [
              {
                id: "call_1",
                type: "function",
                function: {
                  name: "browser_tab",
                  arguments: JSON.stringify({ tabId: TAB, jsCode }),
                },
              },
            ],
          },
          finishReason: "tool_calls",
          usage: { prompt_tokens: 10, completion_tokens: 10, total_tokens: 20 },
        };
      }
      p.seen = req?.messages || null;
      return {
        message: { role: "assistant", content: "done" },
        finishReason: "stop",
        usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
      };
    },
  };
  return p;
}

async function drive(jsCode) {
  const work = workspace("belt");
  const provider = browserProvider(jsCode);
  const events = [];
  let error = null;
  try {
    await runAgentLoop({
      cfg: cfg(work),
      provider,
      workingDir: work,
      userMessage: "run js",
      onEvent: (e) => events.push(e),
    });
  } catch (e) {
    error = e;
  }
  const toolMsg = Array.isArray(provider.seen)
    ? provider.seen.find((m) => m.role === "tool")
    : null;
  return { error, text: String(toolMsg?.content || ""), events };
}

describe("loop belt refuses browser calls the fabric hooks deny", () => {
  it("hands the model the hook's refusal instead of dispatching", async () => {
    const r = await drive("document.body.click()");

    assert.equal(r.error, null, `the run must complete (got: ${r.error?.message})`);
    // Only the belt's short-circuit writes this prefix. The engine refuses this
    // jsCode too, so asserting merely that the call failed proves nothing.
    assert.ok(
      r.text.startsWith("[xclaw-hooks] JSCODE_MOTOR_PATTERN:"),
      `refusal must come from the belt, before dispatch (got: ${r.text.slice(0, 120)})`
    );
    assert.match(r.text, /browser_click \/ browser_type/, "the model must be told what to use instead");
  });

  it("dispatches a browser call the hooks permit", async () => {
    // Same tool, same tab, same policy mode — only the jsCode changes, to one
    // the hook allows and the tool's schema rejects (which it does before any
    // browser work, keeping this case Chrome-free).
    const r = await drive(1);

    assert.equal(r.error, null, `the run must complete (got: ${r.error?.message})`);
    assert.ok(
      !r.text.includes("[xclaw-hooks]"),
      `a permitted call must not be short-circuited (got: ${r.text.slice(0, 120)})`
    );
    assert.match(
      r.text,
      /InputValidationError/,
      "the permitted call must actually have reached the tool — otherwise the " +
        "test above is satisfied by a belt that refuses every browser call"
    );
  });
});
