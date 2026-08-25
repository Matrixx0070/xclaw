/**
 * The gateway bind guard must actually be ASKED (src/gateway/index.mjs).
 *
 * This one is not a coverage gap — it is a shipped regression the suite could
 * not see. `assertBindSafety` was wired into startGateway in 3.76.1 (3ad09af,
 * 2026-08-12 16:29) and lost its call site 34 minutes later to c9a5b10, an
 * unrelated automations feature authored against a pre-guard tree. c9a5b10 is
 * an ancestor of HEAD, so from that commit until v3.188.0 the product never
 * consulted the guard at all, while CHANGELOG.md:3346 and
 * docs/GROK-PROGRESS.md:162 both kept advertising the protection.
 *
 * Nothing went red because both existing test files —
 * test/bind-safety-prod.test.mjs and test/security-top-fixes.test.mjs — call
 * assertBindSafety directly. The pure function was exhaustively correct the
 * whole time; the half that PERFORMS had no test. Same shape as every blind
 * spot in test/loop-guard-enforcement.test.mjs and
 * test/approval-gate-enforcement.test.mjs, taken to its limit: here the call
 * site did not exist.
 *
 * What it protects: with a non-loopback host and no token,
 * createGatewayAuth().check() returns { ok: true, mode: "open" } for protected
 * paths outside prod (src/gateway/auth.mjs), so /agent, /config, /sessions and
 * /hooks — command hooks EXECUTE shell — answer every interface. The only
 * other thing in the tree that notices is validateConfig's advisory
 * "gateway.host is 0.0.0.0 (public bind)" warning, which refuses nothing.
 *
 * No port is ever bound here. startGateway is called with no `root`, so the
 * statement immediately after the guard —
 * `const uiRoot = path.join(root, "ui", "webchat")` — throws
 * `TypeError: The "path" argument must be of type string`. That TypeError is
 * the proof that a case got PAST the bind decision, and it lands long before
 * any listener, channel or computer subprocess starts. A case that is refused
 * never reaches it.
 *
 * Both directions, one field apart: the refusal case and each pass-through
 * case run the same startGateway against the same config file with exactly one
 * thing changed (the host, the token, the escape-hatch env), because a
 * negative case alone is satisfied by a guard that refuses everything.
 */
import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), "xclaw-bindguard-"));
const saved = {};
const ENV_KEYS = [
  "HOME",
  "XCLAW_GATEWAY_TOKEN",
  "XCLAW_GATEWAY_ALLOW_OPEN",
  "XCLAW_GATEWAY_REQUIRE_AUTH",
  "XCLAW_PROFILE",
  "XCLAW_CONFIG_DIR",
  "XCLAW_STATE_DIR",
];

let startGateway;
let quiet;

before(async () => {
  for (const k of ENV_KEYS) saved[k] = process.env[k];
  // os.homedir() re-reads $HOME on POSIX every call, so each case can point
  // loadConfig at its own ~/.xclaw without re-importing the module.
  process.env.HOME = tmpRoot;
  for (const k of ENV_KEYS.slice(1)) delete process.env[k];

  // validateConfig prints its advisory public-bind warning on every case.
  const warn = console.warn;
  const error = console.error;
  const log = console.log;
  console.warn = () => {};
  console.error = () => {};
  console.log = () => {};
  quiet = () => {
    console.warn = warn;
    console.error = error;
    console.log = log;
  };

  ({ startGateway } = await import("../src/gateway/index.mjs"));
});

after(() => {
  if (quiet) quiet();
  for (const [k, v] of Object.entries(saved)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
  fs.rmSync(tmpRoot, { recursive: true, force: true });
});

/**
 * Writes ~/.xclaw/xclaw.json for one case and returns how startGateway ends.
 * The user file's gateway.host beats the profile pack's 127.0.0.1 (merge order
 * is DEFAULT -> profile pack -> user file -> env).
 */
async function bootOutcome({ host, token }) {
  const home = fs.mkdtempSync(path.join(tmpRoot, "home-"));
  fs.mkdirSync(path.join(home, ".xclaw"), { recursive: true });
  fs.writeFileSync(
    path.join(home, ".xclaw", "xclaw.json"),
    JSON.stringify({
      profile: "lab",
      gateway: { host, port: 18999, ...(token ? { token } : {}) },
      computer: { autoStart: false },
      channels: { telegram: { enabled: false }, webchat: { enabled: false } },
    })
  );
  process.env.HOME = home;

  try {
    await startGateway({});
    return { refused: false, message: "resolved" };
  } catch (err) {
    const message = String(err?.message || "");
    return { refused: /refusing to bind gateway/.test(message), message };
  }
}

/** The pass-through marker: the statement right after the guard, no socket. */
const PAST_THE_GUARD = /argument must be of type string/;

describe("gateway refuses to bind beyond loopback without auth", () => {
  it("refuses a public host with no token", async () => {
    const out = await bootOutcome({ host: "0.0.0.0" });

    assert.equal(out.refused, true, `startGateway must refuse (got: ${out.message})`);
    assert.match(out.message, /refusing to bind gateway on 0\.0\.0\.0 without auth/);
    assert.match(out.message, /XCLAW_GATEWAY_TOKEN/, "the refusal must say how to fix it");
  });

  it("starts on loopback with no token", async () => {
    // Same config, same missing token: only the host moves. Without this the
    // case above is satisfied by a startGateway that throws unconditionally.
    const out = await bootOutcome({ host: "127.0.0.1" });

    assert.equal(out.refused, false, "loopback must never be refused");
    assert.match(out.message, PAST_THE_GUARD, `expected to reach uiRoot (got: ${out.message})`);
  });

  it("starts on a public host once a token is configured", async () => {
    // Only gateway.token is added. Pins the token dimension of the guard: a
    // mutant that keyed on the host alone would fail here.
    const out = await bootOutcome({ host: "0.0.0.0", token: "b".repeat(64) });

    assert.equal(out.refused, false, "an authenticated public bind is allowed");
    assert.match(out.message, PAST_THE_GUARD, `expected to reach uiRoot (got: ${out.message})`);
  });

  it("starts on a public host when the operator opts out explicitly", async () => {
    // The documented escape hatch for a trusted network. It must keep working,
    // or the fix turns into an outage for anyone already relying on it.
    process.env.XCLAW_GATEWAY_ALLOW_OPEN = "1";
    try {
      const out = await bootOutcome({ host: "0.0.0.0" });

      assert.equal(out.refused, false, "XCLAW_GATEWAY_ALLOW_OPEN=1 must be honoured");
      assert.match(out.message, PAST_THE_GUARD, `expected to reach uiRoot (got: ${out.message})`);
    } finally {
      delete process.env.XCLAW_GATEWAY_ALLOW_OPEN;
    }
  });
});
