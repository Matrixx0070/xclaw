/**
 * A7 jsCode policy must read the host profile through the owning predicate.
 *
 * jscodeMode() asked `process.env.XCLAW_PROFILE === "prod"` directly. Nothing
 * in src/ or bin/ ever assigns that variable, so an operator who hardens the
 * host the documented config way — profile:"prod" in ~/.xclaw/xclaw.json —
 * left it unset: every other gate agreed the host was hardened (egress deny,
 * isHardenedProfile true) while A7 returned "allow" and a motor-pattern
 * jsCode ran. The canonical spelling `strict`, which sixteen source files
 * treat as the hardened profile, failed the raw compare too.
 *
 * The existing A7 corpus turns enforcement on with XCLAW_FABRIC_ENFORCE, so it
 * exercises the fabric route only and is blind to the profile route by
 * construction. These tests drive the profile route with fabric enforcement
 * OFF, which is exactly the configuration that shipped broken.
 */
import { describe, it, beforeEach, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { jscodeMode, assertJsCodeAllowed, gradeJsCodePolicy } from "../src/browser/jscode-policy.mjs";
import { beforeInput } from "../src/browser/hooks.mjs";
import { setActiveProfile } from "../src/config/profiles.mjs";
import { loadConfig } from "../src/config/load.mjs";

const MOTOR = "document.querySelector('#pay').click()";

const PROFILE_ENV = [
  "XCLAW_PROFILE",
  "XCLAW_JSCODE_MODE",
  "XCLAW_FABRIC_ENFORCE",
  "XCLAW_ENFORCEMENT_STRICT",
];

const saved = {};
for (const k of PROFILE_ENV) saved[k] = process.env[k];
const savedHome = process.env.HOME;
const tmpdirs = [];

/** Load a real config from a throwaway HOME carrying this profile string. */
async function loadWithProfile(profile) {
  const home = await fs.mkdtemp(path.join(os.tmpdir(), "xclaw-jsprof-"));
  tmpdirs.push(home);
  await fs.mkdir(path.join(home, ".xclaw"), { recursive: true });
  await fs.writeFile(
    path.join(home, ".xclaw", "xclaw.json"),
    JSON.stringify({ profile, gateway: { port: 18999 } }) + "\n",
    "utf8"
  );
  process.env.HOME = home;
  return loadConfig();
}

beforeEach(() => {
  for (const k of PROFILE_ENV) delete process.env[k];
  process.env.HOME = savedHome;
  setActiveProfile(null);
});

after(async () => {
  for (const k of PROFILE_ENV) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
  }
  process.env.HOME = savedHome;
  setActiveProfile(null);
  for (const d of tmpdirs) await fs.rm(d, { recursive: true, force: true });
});

describe("A7 jsCode policy — host profile route", () => {
  it("enforces when the config file says prod and no env var is set", async () => {
    await loadWithProfile("prod");
    assert.equal(jscodeMode(), "read");
  });

  it("enforces when the config file says strict (canonical hardened spelling)", async () => {
    await loadWithProfile("strict");
    assert.equal(jscodeMode(), "read");
  });

  it("blocks a motor-pattern jsCode on a config-hardened host", async () => {
    await loadWithProfile("prod");
    const r = assertJsCodeAllowed(MOTOR);
    assert.equal(r.ok, false);
    assert.equal(r.code, "JSCODE_MOTOR_PATTERN");
  });

  it("blocks it end to end through beforeInput, with fabric enforcement off", async () => {
    await loadWithProfile("prod");
    const r = await beforeInput({ action: "jsCode", jsCode: MOTOR });
    assert.equal(r.ok, false);
    assert.equal(r.code, "JSCODE_MOTOR_PATTERN");
  });

  it("still allows read-only jsCode on a hardened host", async () => {
    await loadWithProfile("prod");
    assert.equal(assertJsCodeAllowed("return document.title").ok, true);
  });

  it("leaves a lab host permissive — the hardened check must not over-fire", async () => {
    await loadWithProfile("lab");
    assert.equal(jscodeMode(), "allow");
    assert.equal(assertJsCodeAllowed(MOTOR).ok, true);
  });

  it("honours an explicit XCLAW_JSCODE_MODE override on a hardened host", async () => {
    await loadWithProfile("prod");
    process.env.XCLAW_JSCODE_MODE = "allow";
    assert.equal(jscodeMode(), "allow");
    process.env.XCLAW_JSCODE_MODE = "deny";
    assert.equal(jscodeMode(), "deny");
  });
});

describe("A7 jsCode policy — env profile spellings", () => {
  it("enforces under XCLAW_PROFILE=strict", () => {
    process.env.XCLAW_PROFILE = "strict";
    assert.equal(jscodeMode(), "read");
    assert.equal(assertJsCodeAllowed(MOTOR).code, "JSCODE_MOTOR_PATTERN");
  });

  it("enforces under a mixed-case XCLAW_PROFILE", () => {
    process.env.XCLAW_PROFILE = "Prod";
    assert.equal(jscodeMode(), "read");
  });

  it("still enforces under the literal XCLAW_PROFILE=prod", () => {
    process.env.XCLAW_PROFILE = "prod";
    assert.equal(jscodeMode(), "read");
  });

  it("leaves an unhardened env profile permissive", () => {
    process.env.XCLAW_PROFILE = "lab";
    assert.equal(jscodeMode(), "allow");
  });

  it("an explicit config profile outranks a stale env spelling", async () => {
    process.env.XCLAW_PROFILE = "lab";
    await loadWithProfile("lab");
    assert.equal(jscodeMode(), "allow");
  });
});

describe("A7 jsCode policy — doctor grading", () => {
  it("grades allow on a hardened host as warn, not an ok that claims lab", () => {
    const g = gradeJsCodePolicy({ mode: "allow", hardened: true, blocked: { ok: true } });
    assert.equal(g.severity, "warn");
    assert.ok(!/lab/.test(g.detail), `must not assert lab: ${g.detail}`);
  });

  it("grades allow on an unhardened host as ok", () => {
    const g = gradeJsCodePolicy({ mode: "allow", hardened: false, blocked: { ok: true } });
    assert.equal(g.severity, "ok");
    assert.match(g.detail, /lab/);
  });

  it("grades a blocking read mode as ok and names the code", () => {
    const g = gradeJsCodePolicy({
      mode: "read",
      hardened: true,
      blocked: { ok: false, code: "JSCODE_MOTOR_PATTERN" },
    });
    assert.equal(g.severity, "ok");
    assert.match(g.detail, /JSCODE_MOTOR_PATTERN/);
  });

  it("grades an enforcing mode that failed to block as warn", () => {
    const g = gradeJsCodePolicy({ mode: "read", hardened: true, blocked: { ok: true } });
    assert.equal(g.severity, "warn");
    assert.match(g.detail, /mode=read/);
  });
});

describe("A7 jsCode policy — doctor wiring", () => {
  /**
   * runDoctor's A7 probe calls loadConfig itself, so the row cannot be driven
   * from a test. Read the caller as text instead: what must hold is that the
   * row's severity comes from the grader, fed the host's real hardened state.
   */
  it("doctor grades a.jscode_policy through the grader, with the host's hardened state", async () => {
    const src = await fs.readFile(new URL("../src/cli/doctor.mjs", import.meta.url), "utf8");
    assert.match(
      src,
      /const grade = gradeJsCodePolicy\(\{\s*mode,\s*hardened: isHardenedProfile\(cfg\),\s*blocked,?\s*\}\);/,
      "A7 probe must feed the grader the real hardened state"
    );
    assert.match(
      src,
      /push\("a\.jscode_policy", grade\.severity, grade\.detail\)/,
      "the row must take its severity from the grader"
    );
    assert.doesNotMatch(
      src,
      /push\("a\.jscode_policy", "ok"/,
      "no hard-coded ok for the A7 policy row"
    );
  });
});

describe("A7 role binding — host profile route", () => {
  /**
   * strictMode() in role-binding.mjs carried a byte-identical copy of the same
   * raw compare, gating something heavier: under strict, a session with no
   * bound role is downgraded to observer. On a config-hardened host it stayed
   * "actor", so an unbound session actuated with a role it had never claimed.
   */
  it("downgrades an unbound session to observer on a config-hardened host", async () => {
    await loadWithProfile("prod");
    const { resolveRole } = await import("../src/browser/role-binding.mjs");
    const r = await resolveRole({ sessionId: `t-unbound-${Date.now()}` });
    assert.equal(r.role, "observer");
    assert.equal(r.source, "strict_default");
  });

  it("downgrades under the canonical strict spelling too", async () => {
    process.env.XCLAW_PROFILE = "strict";
    const { resolveRole } = await import("../src/browser/role-binding.mjs");
    const r = await resolveRole({ sessionId: `t-unbound-${Date.now()}` });
    assert.equal(r.role, "observer");
  });

  it("leaves a lab host on the permissive default", async () => {
    await loadWithProfile("lab");
    const { resolveRole } = await import("../src/browser/role-binding.mjs");
    const r = await resolveRole({ sessionId: `t-unbound-${Date.now()}` });
    assert.equal(r.role, "actor");
  });
});
