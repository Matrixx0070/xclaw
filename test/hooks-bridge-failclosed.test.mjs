/**
 * The computer-plane bridge must fail CLOSED on every gate it fronts.
 *
 * beforeInput is the gate that carries the A7 jsCode policy, the motor-role
 * check and the tab lease. When the hooks module cannot be loaded, returning
 * { ok: true, skipped: true } is indistinguishable from "the hook ran and
 * approved" to the only caller (the computer server checks r.ok === false),
 * so the substrate would refuse the safer operation (navigate) and permit the
 * actuating one (click/type/jsCode).
 */
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { setActiveProfile } from "../src/config/profiles.mjs";

const ENV_KEYS = [
  "XCLAW_FABRIC_ENFORCE",
  "XCLAW_COMMIT_GATES",
  "XCLAW_PROFILE",
  "XCLAW_HOOKS_PATH",
  "XCLAW_ROOT",
];

let seq = 0;

/**
 * A bridge instance with its own module-level hook cache, plus a stub hooks
 * module exporting exactly the named hooks.
 */
async function freshBridge(exportNames, env = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "xclaw-bridge-"));
  const stub = path.join(dir, "stub-hooks.mjs");
  const body = exportNames
    .map((n) => `export async function ${n}() { return { ok: true, marker: "${n}" }; }`)
    .join("\n");
  fs.writeFileSync(stub, body || "export const nothing = 1;\n");

  for (const k of ENV_KEYS) delete process.env[k];
  setActiveProfile(null);
  process.env.XCLAW_HOOKS_PATH = stub;
  for (const [k, v] of Object.entries(env)) process.env[k] = v;

  return import(`../src/computer/hooks-bridge.mjs?failclosed=${++seq}`);
}

function restoreEnv() {
  for (const k of ENV_KEYS) delete process.env[k];
  setActiveProfile(null);
}

test.afterEach(restoreEnv);

const INPUT_CTX = {
  tabId: "tab-1",
  action: "click",
  jsCode: "document.querySelector('#confirm-transfer').click()",
};

test("beforeInput fails closed when hooks are unavailable under XCLAW_FABRIC_ENFORCE=1", async () => {
  const b = await freshBridge([], { XCLAW_FABRIC_ENFORCE: "1" });
  const r = await b.runBeforeInput(INPUT_CTX);
  assert.equal(r.ok, false);
  assert.equal(r.code, "HOOKS_UNAVAILABLE");
});

test("beforeInput fails closed for the 'true' spelling of XCLAW_FABRIC_ENFORCE", async () => {
  const b = await freshBridge([], { XCLAW_FABRIC_ENFORCE: "true" });
  const r = await b.runBeforeInput(INPUT_CTX);
  assert.equal(r.ok, false);
  assert.equal(r.code, "HOOKS_UNAVAILABLE");
});

test("beforeInput fails closed under XCLAW_COMMIT_GATES", async () => {
  const b = await freshBridge([], { XCLAW_COMMIT_GATES: "1" });
  const r = await b.runBeforeInput(INPUT_CTX);
  assert.equal(r.ok, false);
  assert.equal(r.code, "HOOKS_UNAVAILABLE");
});

test("beforeNavigate accepts the 'true' spelling too (hooks.mjs already does)", async () => {
  const b = await freshBridge([], { XCLAW_FABRIC_ENFORCE: "true" });
  const r = await b.runBeforeNavigate({ url: "https://example.test/" });
  assert.equal(r.ok, false);
  assert.equal(r.code, "HOOKS_UNAVAILABLE");
});

test("beforeNavigate accepts the 'true' spelling of XCLAW_COMMIT_GATES", async () => {
  const b = await freshBridge([], { XCLAW_COMMIT_GATES: "true" });
  const r = await b.runBeforeNavigate({ url: "https://example.test/" });
  assert.equal(r.ok, false);
  assert.equal(r.code, "HOOKS_UNAVAILABLE");
});

test("a host hardened by profile fails closed on beforeInput with no env var set", async () => {
  const b = await freshBridge([], { XCLAW_PROFILE: "prod" });
  const r = await b.runBeforeInput(INPUT_CTX);
  assert.equal(r.ok, false);
  assert.equal(r.code, "HOOKS_UNAVAILABLE");
});

test("a host hardened by config (published profile, no env) fails closed on beforeInput", async () => {
  const b = await freshBridge([]);
  setActiveProfile("prod");
  const r = await b.runBeforeInput(INPUT_CTX);
  assert.equal(r.ok, false);
  assert.equal(r.code, "HOOKS_UNAVAILABLE");
});

test("a host hardened by config fails closed on beforeNavigate", async () => {
  const b = await freshBridge([]);
  setActiveProfile("prod");
  const r = await b.runBeforeNavigate({ url: "https://example.test/" });
  assert.equal(r.ok, false);
  assert.equal(r.code, "HOOKS_UNAVAILABLE");
});

test("with no enforcement at all, missing hooks stay a skip on both gates", async () => {
  const b = await freshBridge([]);
  assert.deepEqual(await b.runBeforeInput(INPUT_CTX), { ok: true, skipped: true });
  assert.deepEqual(await b.runBeforeNavigate({ url: "https://example.test/" }), {
    ok: true,
    skipped: true,
  });
});

test("the guard never shadows a hook that is actually present", async () => {
  const b = await freshBridge(["beforeInput", "beforeNavigate"], {
    XCLAW_FABRIC_ENFORCE: "1",
  });
  assert.equal((await b.runBeforeInput(INPUT_CTX)).marker, "beforeInput");
  assert.equal((await b.runBeforeNavigate({ url: "u" })).marker, "beforeNavigate");
});

test("beforeInput reports the phase it failed in", async () => {
  const b = await freshBridge([], { XCLAW_FABRIC_ENFORCE: "1" });
  assert.equal((await b.runBeforeInput(INPUT_CTX)).phase, "beforeInput");
  const b2 = await freshBridge([], { XCLAW_FABRIC_ENFORCE: "1" });
  assert.equal((await b2.runBeforeNavigate({ url: "u" })).phase, "beforeNavigate");
});

test("hooksEnforcementOn reads every route the enforcement plane accepts", async () => {
  const b = await freshBridge([]);
  assert.equal(b.hooksEnforcementOn(), false);
  for (const [k, v] of [
    ["XCLAW_FABRIC_ENFORCE", "1"],
    ["XCLAW_FABRIC_ENFORCE", "true"],
    ["XCLAW_COMMIT_GATES", "1"],
    ["XCLAW_COMMIT_GATES", "true"],
  ]) {
    process.env[k] = v;
    assert.equal(b.hooksEnforcementOn(), true, `${k}=${v}`);
    delete process.env[k];
  }
  assert.equal(b.hooksEnforcementOn(), false);
  setActiveProfile("prod");
  assert.equal(b.hooksEnforcementOn(), true, "hardened profile");
  setActiveProfile("dev");
  assert.equal(b.hooksEnforcementOn(), false, "dev profile");
});

test("an unrelated env value does not turn enforcement on", async () => {
  const b = await freshBridge([], { XCLAW_FABRIC_ENFORCE: "0" });
  assert.equal(b.hooksEnforcementOn(), false);
  assert.deepEqual(await b.runBeforeInput(INPUT_CTX), { ok: true, skipped: true });
});
