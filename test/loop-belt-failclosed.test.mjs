/**
 * The gateway belt must fail CLOSED when a fabric hook throws.
 *
 * `loop.mjs` wraps browser-tab calls in a belt: resolve the role, ask
 * `beforeNavigate`/`beforeInput` for a verdict, and dispatch only if the verdict
 * is ok. The whole thing sat inside ONE try whose catch dispatched the call
 * anyway — so any throw in the DECISION phase performed the ACTION unchecked,
 * with the error bound to `beltErr` and never read: no event, no log.
 *
 * `test/loop-browser-hook-enforcement.test.mjs` noted this and declined to test
 * it, reasoning that "today's hooks return typed results and do not throw". That
 * is true of the two entry points and false of the graph beneath them:
 *
 *   beforeInput → requireTabLease → acquireTabLease → withFabricLock
 *                                                   → acquireFabricLock
 *                                                   → fs.mkdir(fabricRoot())
 *
 * Nothing on that path catches. An unwritable fabric root — a full disk, a
 * revoked mount, a stale XCLAW_FABRIC_DIR — used to turn the lease requirement
 * into a browser action with no lease and no hook verdict at all. The stronger
 * the enforcement config, the more code runs inside the try and the more ways
 * it has to fail open.
 *
 * Forcing it: point XCLAW_FABRIC_DIR under a parent that is a regular FILE, so
 * the recursive mkdir raises ENOTDIR. Mode bits would not do — the suite runs as
 * root, which ignores them; ENOTDIR is a type error the kernel enforces for
 * everyone.
 *
 * Both directions, one config: the only difference between the two cases is
 * whether the fabric root is writable. Without the mirror, a belt that refused
 * every browser call would pass.
 */
import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";

const TAB = "tab-belt-failclosed";
let runAgentLoop;
let tmpHome;
const saved = {};

const ENV = [
  "HOME",
  "XCLAW_STATE_DIR",
  "XCLAW_FABRIC_DIR",
  "XCLAW_FABRIC_ENFORCE",
  "XCLAW_TAB_LEASE_AUTO",
  "XCLAW_JSCODE_MODE",
  "XCLAW_AGENT_ROLE",
  "XCLAW_ROLE_FROM_ENV",
  "XCLAW_EGRESS",
  "XCLAW_PROFILE",
];

before(async () => {
  for (const k of ENV) saved[k] = process.env[k];
  tmpHome = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "xclaw-belt-fc-")));
  process.env.HOME = tmpHome;
  process.env.XCLAW_STATE_DIR = tmpHome;
  process.env.XCLAW_FABRIC_ENFORCE = "1";
  process.env.XCLAW_TAB_LEASE_AUTO = "1";
  process.env.XCLAW_JSCODE_MODE = "read";
  // Strict mode ignores XCLAW_AGENT_ROLE unless roles may come from env, and
  // falls back to `observer` — which cannot use motor, so the hook would DENY
  // before ever reaching the lease. This test needs the lease path.
  process.env.XCLAW_AGENT_ROLE = "actor";
  process.env.XCLAW_ROLE_FROM_ENV = "1";
  delete process.env.XCLAW_EGRESS;
  delete process.env.XCLAW_PROFILE;
  ({ runAgentLoop } = await import("../src/agent/loop.mjs"));
});

after(() => {
  for (const [k, v] of Object.entries(saved)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
  fs.rmSync(tmpHome, { recursive: true, force: true });
});

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
function browserProvider() {
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
                // jsCode:1 passes the read-mode policy (no motor pattern) and
                // fails the tool's input schema, so a dispatched call is
                // identifiable without a browser.
                function: { name: "browser_tab", arguments: JSON.stringify({ tabId: TAB, jsCode: 1 }) },
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

async function drive(fabricDir) {
  process.env.XCLAW_FABRIC_DIR = fabricDir;
  const work = fs.realpathSync(fs.mkdtempSync(path.join(tmpHome, "work-")));
  const provider = browserProvider();
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
  const toolMsg = Array.isArray(provider.seen) ? provider.seen.find((m) => m.role === "tool") : null;
  return { error, text: String(toolMsg?.content || ""), events };
}

describe("loop belt fails closed when a fabric hook throws", () => {
  it("refuses the call instead of dispatching it unchecked", async () => {
    // Parent is a regular file → mkdir(fabricRoot) raises ENOTDIR for root too.
    const blocker = path.join(tmpHome, "not-a-dir");
    fs.writeFileSync(blocker, "x");
    const r = await drive(path.join(blocker, "fabric"));

    assert.equal(r.error, null, `the run must complete (got: ${r.error?.message})`);
    assert.ok(
      !/InputValidationError/.test(r.text),
      `a hook that threw must NOT reach dispatch — the tool ran anyway (got: ${r.text.slice(0, 200)})`
    );
    assert.match(
      r.text,
      /^\[xclaw-hooks\] HOOK_ERROR:/,
      `the model must be told the belt refused, and why (got: ${r.text.slice(0, 200)})`
    );
    const ev = r.events.find((e) => e.type === "security" && e.phase === "browser_belt_error");
    assert.ok(ev, "a swallowed belt error is invisible — the failure must emit an event");
    assert.match(String(ev.error || ""), /ENOTDIR/, `the event must carry the real cause (got: ${ev.error})`);
  });

  it("dispatches normally when the same hooks succeed", async () => {
    // Identical config; only the fabric root changes. Without this case the
    // test above is satisfied by a belt that refuses every browser call.
    const r = await drive(path.join(tmpHome, "fabric-ok"));

    assert.equal(r.error, null, `the run must complete (got: ${r.error?.message})`);
    assert.ok(
      !r.text.includes("[xclaw-hooks]"),
      `a permitted call must not be short-circuited (got: ${r.text.slice(0, 200)})`
    );
    assert.match(r.text, /InputValidationError/, "the permitted call must actually have reached the tool");
  });
});
