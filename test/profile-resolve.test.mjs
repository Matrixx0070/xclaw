import { describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import {
  PROFILES,
  applyProfile,
  resolveProfileName,
  isHardenedProfile,
} from "../src/config/profiles.mjs";
import { enforceProdHardening, loadConfig } from "../src/config/load.mjs";
import { runSecurityAudit } from "../src/security/audit.mjs";

// The profile name is a free-form operator string, and three separate gates
// each decided for themselves what it meant:
//
//   enforceProdHardening  String(profile).toLowerCase() !== "prod" -> skip
//   security/audit.mjs    cfg.profile === "prod" (raw)             -> skip
//   applyProfile          PROFILES[name] or no pack at all
//
// So the answer to "is this host hardened?" depended on which gate you asked.
// Measured against the real loadConfig before the fix:
//
//   XCLAW_PROFILE   autoApprove   prod hardening   audit prod rules
//   prod            false         3 forced         applied (1 error)
//   production      TRUE          0                not applied
//   prd             TRUE          0                not applied
//   strict          TRUE          0                not applied
//   Prod            false         4 forced         not applied
//
// `production` and `prd` are the operator typos, and both fail OPEN: full
// auto-approve on a host the operator believes they hardened. The only signal
// was a console.warn at boot saying "using config as-is", which nothing reads.

/** Compose the two gates in the order loadConfig composes them. */
const load = (profile, extra = {}) =>
  enforceProdHardening(applyProfile({ profile, security: { autoApprove: true }, ...extra }));

const appliedProdRules = (cfg) =>
  runSecurityAudit(cfg).findings.some((f) => f.id === "profile.prod");

describe("a profile name means the same thing to every gate that reads it", () => {
  it("applies the hardened pack to the name the codebase itself uses for it", () => {
    // profiles.mjs line 1 calls prod "(strict)" and sixteen source files test
    // `profile === "strict"` as the hardened case — but it was never a PROFILES
    // key, so it applied no pack, no hardening, and no prod audit rules. The
    // most hardened-sounding value produced the least hardened host.
    const cfg = load("strict");
    assert.equal(cfg.profile, "prod");
    assert.equal(cfg.security.autoApprove, false);
    assert.ok(appliedProdRules(cfg), "audit skipped its prod rules");
  });

  it("hardens and audits the same host when the name is capitalised", () => {
    // enforceProdHardening lowercased, the audit did not: `Prod` hardened the
    // config while the audit graded it as a non-prod host.
    const cfg = load("Prod");
    assert.equal(cfg.profile, "prod");
    assert.equal(cfg.security.autoApprove, false);
    assert.ok(appliedProdRules(cfg), "hardening applied but the audit disagreed");
  });

  it("reports an unrecognised profile instead of silently running unhardened", () => {
    const cfg = load("production");
    const audit = runSecurityAudit(cfg);
    const f = audit.findings.find((x) => x.id === "profile.unknown");
    assert.ok(f, "a typo'd profile produced no finding at all");
    assert.equal(f.level, "error");
    assert.match(f.message, /production/, f.message);
    // The remedy must name the set the operator can actually choose from.
    assert.match(f.fix, /dev.*lab.*prod/, f.fix);
    assert.equal(audit.ok, false);
  });

  it("agrees with enforceProdHardening for every spelling of the hardened profile", () => {
    for (const name of ["prod", "Prod", "PROD", " prod ", "strict", "Strict"]) {
      const cfg = load(name);
      assert.equal(isHardenedProfile(cfg), true, name);
      assert.equal(cfg.security.autoApprove, false, name);
      assert.ok(appliedProdRules(cfg), `${name}: audit skipped its prod rules`);
    }
    for (const name of ["dev", "lab"]) {
      assert.equal(isHardenedProfile({ profile: name }), false, name);
    }
  });

  it("reads the env override the audit used to read for itself", () => {
    const prev = process.env.XCLAW_PROFILE;
    try {
      process.env.XCLAW_PROFILE = "strict";
      assert.equal(isHardenedProfile({}), true);
      process.env.XCLAW_PROFILE = "lab";
      assert.equal(isHardenedProfile({}), false);
    } finally {
      if (prev === undefined) delete process.env.XCLAW_PROFILE;
      else process.env.XCLAW_PROFILE = prev;
    }
  });

  it("resolves a name to one canonical id, or says it does not know it", () => {
    assert.deepEqual(resolveProfileName("Strict"), { input: "Strict", id: "prod", known: true });
    assert.deepEqual(resolveProfileName(" lab "), { input: "lab", id: "lab", known: true });
    assert.equal(resolveProfileName("prd").known, false);
    assert.equal(resolveProfileName("").known, false);
  });

  it("leaves the three real profiles exactly as they were", () => {
    assert.deepEqual(Object.keys(PROFILES), ["dev", "lab", "prod"]);
    assert.equal(applyProfile({ profile: "dev" }).security.autoApprove, true);
    assert.equal(applyProfile({ profile: "lab" }).security.autoApprove, true);
    assert.equal(applyProfile({ profile: "prod" }).security.autoApprove, false);
    assert.equal(runSecurityAudit({ profile: "lab" }).findings.some((f) => f.id === "profile.unknown"), false);
  });
});

describe("each gate resolves the profile name itself", () => {
  // Composing applyProfile -> enforceProdHardening (as loadConfig does) hides
  // whether the SECOND gate can answer for itself: the first one has already
  // canonicalised the name. Both of these are called directly on configs that
  // never passed through applyProfile — runSecurityAudit grades whatever cfg
  // doctor hands it, and enforceProdHardening is the last gate in loadConfig,
  // after a user file has merged its own raw `profile` string back over the
  // canonical one. So each must resolve the name, not trust its caller.
  it("hardens a raw config for every spelling of the hardened profile", () => {
    for (const name of ["strict", "Prod", "PROD", " prod "]) {
      const out = enforceProdHardening({ profile: name, security: { autoApprove: true } });
      assert.equal(out.security.autoApprove, false, name);
      assert.ok(out._prodHardening?.length, `${name}: hardening skipped entirely`);
    }
    // and does not harden what is not the hardened profile
    for (const name of ["dev", "lab", "production"]) {
      assert.equal(
        enforceProdHardening({ profile: name, security: { autoApprove: true } }).security.autoApprove,
        true,
        name
      );
    }
  });

  it("applies the prod audit rules to a raw config, whatever the spelling", () => {
    for (const name of ["strict", "Prod", "prod"]) {
      const f = runSecurityAudit({ profile: name, security: { autoApprove: true } }).findings.find(
        (x) => x.id === "profile.prod"
      );
      assert.ok(f, `${name}: audit skipped its prod rules`);
      assert.equal(f.level, "error", name);
    }
    assert.equal(
      runSecurityAudit({ profile: "lab" }).findings.some((f) => f.id === "profile.prod"),
      false
    );
  });
});

describe("loadConfig stores the profile that was actually applied", () => {
  // cfg.profile was re-stamped with the RAW env string after applyProfile had
  // normalised it, so every downstream reader saw the operator's spelling
  // rather than the profile in force. Isolate HOME: getConfigDir() is
  // os.homedir() + "/.xclaw" with no env override.
  const withHome = async (userCfg, env, fn) => {
    const home = await fs.mkdtemp(path.join(os.tmpdir(), "xclaw-profile-"));
    await fs.mkdir(path.join(home, ".xclaw"), { recursive: true });
    await fs.writeFile(path.join(home, ".xclaw", "xclaw.json"), JSON.stringify(userCfg));
    const saved = { HOME: process.env.HOME, XCLAW_PROFILE: process.env.XCLAW_PROFILE };
    process.env.HOME = home;
    if (env.XCLAW_PROFILE == null) delete process.env.XCLAW_PROFILE;
    else process.env.XCLAW_PROFILE = env.XCLAW_PROFILE;
    try {
      return await fn(await loadConfig());
    } finally {
      for (const [k, v] of Object.entries(saved)) {
        if (v == null) delete process.env[k];
        else process.env[k] = v;
      }
    }
  };

  it("canonicalises a profile named by the environment", async () => {
    await withHome({}, { XCLAW_PROFILE: "Prod" }, (cfg) => {
      assert.equal(cfg.profile, "prod", "env spelling was stamped back onto cfg.profile");
      assert.equal(cfg.security.autoApprove, false);
      assert.equal(runSecurityAudit(cfg).findings.some((f) => f.id === "profile.prod"), true);
    });
  });

  it("canonicalises a profile named by the config file, and applies its pack", async () => {
    await withHome({ profile: "strict" }, {}, (cfg) => {
      assert.equal(cfg.profile, "prod");
      // The pack is the half that silently went missing: hardening forced
      // autoApprove off, but requireAuth/egress/maxTurns never arrived.
      assert.equal(cfg.gateway.requireAuth, true, "prod pack was never applied");
      assert.equal(cfg.security.egress?.mode, "deny");
      assert.equal(cfg.security.autoApprove, false);
    });
  });

  it("leaves a real profile and an operator typo alone", async () => {
    await withHome({}, { XCLAW_PROFILE: "lab" }, (cfg) => {
      assert.equal(cfg.profile, "lab");
      assert.equal(runSecurityAudit(cfg).ok, true);
    });
    // Not guessed at — "prd" could as easily have meant dev. Reported instead,
    // quoting the operator's own spelling back at them: lowercasing a name we
    // could not resolve would show them a string they never typed, in the one
    // message whose whole job is to help them spot their typo.
    for (const typo of ["prd", "Prd", " PRODUCTION "]) {
      await withHome({}, { XCLAW_PROFILE: typo }, (cfg) => {
        assert.equal(cfg.profile, typo.trim(), typo);
        const f = runSecurityAudit(cfg).findings.find((x) => x.id === "profile.unknown");
        assert.ok(f, `${typo}: unknown profile went unreported`);
        assert.match(f.message, new RegExp(`"${typo.trim()}"`), typo);
      });
    }
  });
});
