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
  // The jsCode policy is part of the posture the bridge now reports, and it
  // reads its own levers -- leaving either set leaks between cases.
  "XCLAW_JSCODE_MODE",
  "XCLAW_ENFORCEMENT_STRICT",
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

// --- posture reporting ------------------------------------------------------
//
// Nothing outside the computer server process could observe its enforcement
// posture, and nothing asked. hooksStatus() exists but reads the env of
// whichever process calls it, so the CLI and the live-e2e probe were both
// reporting their OWN posture as if it were the server's. Measured on this
// host: the running server's /proc/<pid>/environ carried none of the
// enforcement variables the probe had set on itself, and the probe reported
// the gates broken rather than unarmed.

test("the posture reports every lever a caller needs to grade a gate result", async () => {
  const b = await freshBridge([]);
  const p = await b.hooksEnforcementPosture();
  for (const k of [
    "enforcing",
    "fabricEnforce",
    "commitGates",
    "hardenedProfile",
    "jscodeMode",
    "hooksModule",
    "pid",
  ]) {
    assert.ok(k in p, `posture drops ${k}`);
  }
  // The pid is what makes the posture attributable: a reader can tell the
  // server answered rather than the process doing the asking.
  assert.equal(p.pid, process.pid);
});

test("hooksModule reports whether the hooks actually load, not whether a file exists", async () => {
  // The first version of this field was Boolean(resolveHooksModulePath()), and
  // a mutation to a bare `true` left the suite green -- because the resolver
  // falls back to process.cwd() and to this file's own ../.., both of which are
  // the package root, both of which contain src/browser/hooks.mjs. The field
  // could not be false in any reachable configuration: a constant printed as an
  // observation, which is the exact defect this slice exists to close.
  // loadHooks() returning null IS the fail-closed condition -- unresolvable
  // path OR a module that throws on import -- so that is what the posture
  // reports.
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "xclaw-bridge-broken-"));
  const broken = path.join(dir, "throws-hooks.mjs");
  fs.writeFileSync(broken, "throw new Error('boom');\n");
  try {
    for (const k of ENV_KEYS) delete process.env[k];
    setActiveProfile(null);
    process.env.XCLAW_HOOKS_PATH = broken;
    const b = await import(`../src/computer/hooks-bridge.mjs?broken=${++seq}`);
    const p = await b.hooksEnforcementPosture();
    assert.equal(p.hooksModule, false);
  } finally {
    restoreEnv();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("posture.enforcing agrees with hooksEnforcementOn on every route", async () => {
  const b = await freshBridge([]);
  const agree = async (label) =>
    assert.equal((await b.hooksEnforcementPosture()).enforcing, b.hooksEnforcementOn(), label);
  await agree("bare");
  for (const [k, v] of [
    ["XCLAW_FABRIC_ENFORCE", "1"],
    ["XCLAW_FABRIC_ENFORCE", "true"],
    ["XCLAW_COMMIT_GATES", "1"],
    ["XCLAW_COMMIT_GATES", "true"],
  ]) {
    process.env[k] = v;
    await agree(`${k}=${v}`);
    assert.equal((await b.hooksEnforcementPosture()).enforcing, true, `${k}=${v} must enforce`);
    delete process.env[k];
  }
  setActiveProfile("prod");
  await agree("prod profile");
  assert.equal((await b.hooksEnforcementPosture()).enforcing, true);
  setActiveProfile("dev");
  await agree("dev profile");
  assert.equal((await b.hooksEnforcementPosture()).enforcing, false);
});

test("each lever is reported separately, not collapsed into enforcing", async () => {
  // "enforcement is off" without naming the switch is not actionable, and the
  // two switches have different owners: env on a spawned computer, profile in
  // the config file.
  const b = await freshBridge([]);
  process.env.XCLAW_COMMIT_GATES = "1";
  let p = await b.hooksEnforcementPosture();
  assert.deepEqual(
    { c: p.commitGates, f: p.fabricEnforce, h: p.hardenedProfile },
    { c: true, f: false, h: false }
  );
  delete process.env.XCLAW_COMMIT_GATES;
  process.env.XCLAW_FABRIC_ENFORCE = "true";
  p = await b.hooksEnforcementPosture();
  assert.deepEqual(
    { c: p.commitGates, f: p.fabricEnforce, h: p.hardenedProfile },
    { c: false, f: true, h: false }
  );
  delete process.env.XCLAW_FABRIC_ENFORCE;
  setActiveProfile("prod");
  p = await b.hooksEnforcementPosture();
  assert.deepEqual(
    { c: p.commitGates, f: p.fabricEnforce, h: p.hardenedProfile },
    { c: false, f: false, h: true }
  );
});

test("jscodeMode is reported as its own lever, not derived from enforcing", async () => {
  // jscodeMode() honours XCLAW_ENFORCEMENT_STRICT, which hooksEnforcementOn()
  // does not, and XCLAW_JSCODE_MODE overrides both. A posture that derived one
  // from the other would report a gate armed while it returns "allow" before
  // examining a single motor pattern.
  const b = await freshBridge([]);
  assert.equal((await b.hooksEnforcementPosture()).jscodeMode, "allow");

  process.env.XCLAW_COMMIT_GATES = "1";
  const armedButAllow = await b.hooksEnforcementPosture();
  assert.equal(armedButAllow.enforcing, true);
  assert.equal(armedButAllow.jscodeMode, "allow", "commitGates alone does not arm jsCode");
  delete process.env.XCLAW_COMMIT_GATES;

  process.env.XCLAW_JSCODE_MODE = "deny";
  assert.equal((await b.hooksEnforcementPosture()).jscodeMode, "deny");
  assert.equal((await b.hooksEnforcementPosture()).enforcing, false, "jsCode mode does not arm the gates");
  delete process.env.XCLAW_JSCODE_MODE;

  process.env.XCLAW_ENFORCEMENT_STRICT = "1";
  assert.equal((await b.hooksEnforcementPosture()).jscodeMode, "read");
  assert.equal(
    (await b.hooksEnforcementPosture()).enforcing,
    false,
    "XCLAW_ENFORCEMENT_STRICT is a jsCode lever only -- the two predicates genuinely differ"
  );
});
