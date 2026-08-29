/**
 * The live enforcement probe graded gates it could not prove were armed.
 *
 * Both defects pinned here were found by running scripts/live-enforcement-e2e.mjs
 * against the real computer server on this host; the suite was green throughout.
 */
import test from "node:test";
import assert from "node:assert/strict";

import {
  GATES,
  REQUIREMENTS,
  classifyGateOutcome,
  describePosture,
  unmetPosture,
} from "../src/computer/enforcement-probe.mjs";

const ARMED = {
  enforcing: true,
  fabricEnforce: true,
  commitGates: true,
  hardenedProfile: false,
  jscodeMode: "read",
  hooksModule: true,
};
const UNARMED = {
  enforcing: false,
  fabricEnforce: false,
  commitGates: false,
  hardenedProfile: false,
  jscodeMode: "allow",
  hooksModule: true,
};

// --- classification ---------------------------------------------------------

test("a gate code in the tool text is a block", () => {
  const g = GATES["live.commit_gate"];
  assert.equal(
    classifyGateOutcome({ text: "[xclaw-hooks] COMMIT_GATE: approval required", gate: g }),
    "blocked"
  );
  assert.equal(
    classifyGateOutcome({
      text: "[xclaw-hooks] JSCODE_MOTOR_PATTERN: use browser_click",
      gate: GATES["live.jscode_block"],
    }),
    "blocked"
  );
});

test("the exact live SSRF text is a transport error, not a gate letting the probe through", () => {
  // Verbatim from the failing run this slice was written against.
  const text =
    "Error: Failed to interact with browser tab: [xclaw-ssrf] SSRF_BLOCKED: " +
    "DNS resolution failed for shop.example: getaddrinfo ENOTFOUND shop.example";
  assert.equal(
    classifyGateOutcome({ text, gate: GATES["live.commit_gate"] }),
    "transport-error"
  );
  // The old predicate graded this "allowed" -- the gate blamed for a request
  // that never reached it.
  assert.notEqual(classifyGateOutcome({ text, gate: GATES["live.commit_gate"] }), "allowed");
});

test("every transport failure mode the probe can hit is classified as one", () => {
  for (const text of [
    "SSRF_BLOCKED: private address",
    "getaddrinfo ENOTFOUND shop.example",
    "getaddrinfo EAI_AGAIN shop.example",
    "connect ECONNREFUSED 127.0.0.1:9222",
    "read ECONNRESET",
    "connect ETIMEDOUT",
    "net::ERR_NAME_NOT_RESOLVED",
  ]) {
    assert.equal(
      classifyGateOutcome({ text, gate: GATES["live.commit_gate"] }),
      "transport-error",
      text
    );
  }
});

test("a missing browser is its own outcome, distinct from a transport failure", () => {
  for (const text of ["No usable Chrome found", "failed to launch chrome", "Chrome binary missing"]) {
    assert.equal(
      classifyGateOutcome({ text, gate: GATES["live.commit_gate"] }),
      "chrome-unavailable",
      text
    );
  }
});

test("a transport failure outranks the chrome arm when both words appear", () => {
  // net::ERR_ lines routinely name chrome; grading them "chrome-unavailable"
  // would hide a reachability fault behind a browser-setup warning.
  assert.equal(
    classifyGateOutcome({
      text: "chrome: net::ERR_NAME_NOT_RESOLVED",
      gate: GATES["live.commit_gate"],
    }),
    "transport-error"
  );
});

test("a gate code outranks a transport failure when both appear in one message", () => {
  // The order of the arms in classifyGateOutcome IS the module's contract, and
  // it was unpinned: swapping the blocked and transport checks left the suite
  // green. The two are not symmetric. A gate code proves the enforcement plane
  // refused; a transport word only proves the request had trouble reaching the
  // page, which is why it downgrades a gate to "unprovable" rather than to a
  // pass. A hook that denies a navigation reports the URL it denied, so the
  // reason string can easily carry both -- and grading that as transport would
  // turn a real, observed block into "could not test".
  for (const text of [
    "Error: [xclaw-hooks] ROLE_NO_NAVIGATE: https://shop.example — DNS resolution failed",
    "Error: [xclaw-hooks] beforeNavigate denied: getaddrinfo ENOTFOUND shop.example",
    "[xclaw-ssrf] SSRF_BLOCKED refused by beforeNavigate",
  ]) {
    assert.equal(
      classifyGateOutcome({ text, isError: true, gate: GATES["live.commit_gate"] }),
      "blocked",
      text
    );
  }
});

test("an unrecognised error is indeterminate, never counted as a block", () => {
  const r = classifyGateOutcome({ text: "boom", isError: true, gate: GATES["live.commit_gate"] });
  assert.equal(r, "error");
  assert.notEqual(r, "blocked");
});

test("a clean success-like result is the only thing graded as allowed", () => {
  assert.equal(classifyGateOutcome({ text: "navigated", gate: GATES["live.commit_gate"] }), "allowed");
  assert.equal(classifyGateOutcome({ text: "", gate: GATES["live.commit_gate"] }), "allowed");
  assert.equal(classifyGateOutcome({ gate: GATES["live.commit_gate"] }), "allowed");
});

test("classification never depends on a previous call", () => {
  // A /g regexp carries lastIndex between calls, so the second probe of an
  // identical text would classify differently from the first.
  const text = "[xclaw-hooks] COMMIT_GATE: nope";
  for (let i = 0; i < 3; i++) {
    assert.equal(classifyGateOutcome({ text, gate: GATES["live.commit_gate"] }), "blocked", `call ${i}`);
  }
});

// --- posture preconditions --------------------------------------------------

test("an armed posture leaves both gates provable", () => {
  for (const id of Object.keys(GATES)) {
    assert.equal(unmetPosture(GATES[id].requires, ARMED), null, id);
  }
});

test("an unarmed computer makes the commit gate unprovable and says which levers are off", () => {
  const why = unmetPosture(GATES["live.commit_gate"].requires, UNARMED);
  assert.ok(why, "an unarmed host must not be silently graded");
  assert.match(why, /commitGates=false/);
  assert.match(why, /fabricEnforce=false/);
});

test('jsCode mode "allow" makes the jscode gate unprovable even when enforcement is on', () => {
  // The two levers are independent: XCLAW_JSCODE_MODE=allow short-circuits
  // assertJsCodeAllowed before the motor patterns are ever examined.
  const why = unmetPosture(GATES["live.jscode_block"].requires, { ...ARMED, jscodeMode: "allow" });
  assert.ok(why);
  assert.match(why, /allow/);
});

test("a jscode mode that blocks needs a hooks module or a fail-closed enforcement plane", () => {
  // mode=read with hooks absent and enforcement off is a skip, not a block:
  // the bridge returns { ok: true, skipped: true }.
  assert.ok(
    unmetPosture("jscode", { ...UNARMED, jscodeMode: "read", hooksModule: false }),
    "hooks absent + not enforcing cannot block"
  );
  assert.equal(
    unmetPosture("jscode", { ...UNARMED, jscodeMode: "read", hooksModule: true }),
    null,
    "hooks present can block"
  );
  assert.equal(
    unmetPosture("jscode", { enforcing: true, jscodeMode: "read", hooksModule: false }),
    null,
    "enforcing fails closed even with hooks missing"
  );
});

test("a server that reports no posture at all leaves every gate unprovable", () => {
  for (const absent of [null, undefined]) {
    for (const id of Object.keys(GATES)) {
      const why = unmetPosture(GATES[id].requires, absent);
      assert.ok(why, `${id} with posture ${String(absent)}`);
      assert.match(why, /posture/i);
    }
  }
});

test("describePosture names every lever the message needs to be actionable", () => {
  const s = describePosture(UNARMED);
  for (const k of ["commitGates", "fabricEnforce", "hardenedProfile", "jscodeMode", "hooksModule"]) {
    assert.ok(s.includes(k), `describePosture drops ${k}`);
  }
  assert.match(describePosture(null), /unreported/i);
});

test("every gate declares a requirement unmetPosture actually understands", () => {
  // A gate whose `requires` string falls through would be graded as provable on
  // any host -- the fail-open this slice closed, reintroduced by a typo.
  for (const [id, g] of Object.entries(GATES)) {
    assert.ok(g.blocked instanceof RegExp, `${id} has no block pattern`);
    assert.ok(typeof g.requires === "string" && g.requires, `${id} has no requirement`);
    assert.ok(REQUIREMENTS.has(g.requires), `${id} requirement ${g.requires} is not understood`);
    assert.ok(unmetPosture(g.requires, null), `${id} must be unprovable without posture`);
  }
});

test("an unrecognised requirement is never provable", () => {
  // The alternative is silently returning null, i.e. "precondition met", for a
  // requirement nothing implements.
  assert.ok(unmetPosture("typo", ARMED));
  assert.ok(unmetPosture(undefined, ARMED));
});
