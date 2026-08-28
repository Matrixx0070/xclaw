import { describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { runSecurityAudit } from "../src/security/audit.mjs";
import { DM_POSTURE, effectiveDmPolicy, isOpenDm, dmRemedy } from "../src/channels/dm-posture.mjs";

const audit = (channels) =>
  runSecurityAudit({
    profile: "prod",
    gateway: { host: "127.0.0.1", token: "t" },
    security: { autoApprove: false },
    agent: { apiKey: "x" },
    channels,
  });
const dmFindings = (a) => a.findings.filter((f) => /\.dm$/.test(f.id || ""));

describe("what a channel actually enforces, not what the config asks for", () => {
  // The table mirrors three source files; drift from them is the failure mode,
  // and slack's default is not otherwise observable (anything outside
  // `enforces` resolves open regardless), so pin the literals.
  it("records the default each channel's own source applies", () => {
    assert.equal(DM_POSTURE.telegram.default, "pairing");
    assert.equal(DM_POSTURE.discord.default, "pairing");
    assert.equal(DM_POSTURE.slack.default, "open");
  });

  it("defaults telegram and discord to pairing", () => {
    assert.equal(effectiveDmPolicy("telegram", {}), "pairing");
    assert.equal(effectiveDmPolicy("discord", {}), "pairing");
  });

  // src/channels/slack/index.mjs:74 — `conf.dmPolicy || "open"`, and line 133
  // gates on "allowlist" alone. Slack is the one channel whose default is open.
  it("defaults slack to open", () => {
    assert.equal(effectiveDmPolicy("slack", {}), "open");
    assert.equal(isOpenDm("slack", { enabled: true }), true);
  });

  // The remedy every surface prints — "prefer pairing" — is a no-op on Slack:
  // there is no pairing store, so the value falls through to allow-all.
  it("reports slack dmPolicy=pairing as the open policy it really is", () => {
    assert.equal(effectiveDmPolicy("slack", { dmPolicy: "pairing" }), "open");
    assert.equal(isOpenDm("slack", { dmPolicy: "pairing" }), true);
  });

  it("honours the one policy slack does enforce", () => {
    assert.equal(effectiveDmPolicy("slack", { dmPolicy: "allowlist" }), "allowlist");
    assert.equal(isOpenDm("slack", { dmPolicy: "allowlist" }), false);
  });

  it("treats an unrecognised policy as open on every channel", () => {
    for (const ch of Object.keys(DM_POSTURE)) {
      assert.equal(effectiveDmPolicy(ch, { dmPolicy: "paring" }), "open", ch);
    }
  });

  it("has no opinion about channels with no DM policy", () => {
    // email and webchat never read dmPolicy; saying "open" about them would be
    // a finding no operator could act on.
    assert.equal(effectiveDmPolicy("email", {}), null);
    assert.equal(isOpenDm("webchat", { enabled: true }), false);
  });

  it("never sends a slack operator to pairing, and says why", () => {
    // The old remedy was "Prefer pairing or allowlist" for every channel —
    // half of it a dead end on Slack. Naming the reason is what stops an
    // operator retrying the value that silently does nothing.
    assert.doesNotMatch(dmRemedy("slack"), /prefer pairing/i);
    assert.match(dmRemedy("slack"), /no pairing store/i);
    assert.match(dmRemedy("slack"), /allowlist/i);
    assert.match(dmRemedy("telegram"), /prefer pairing/i);
  });
});

describe("the security audit sees every channel that gates senders", () => {
  // Observed on the clean 3.327.0 tree, profile "prod": all three of these
  // produced NO finding at all, because the loop read ["telegram","discord"].
  for (const [name, conf] of [
    ["no dmPolicy at all", { enabled: true }],
    ["dmPolicy=pairing, which slack ignores", { enabled: true, dmPolicy: "pairing" }],
    ["dmPolicy=open", { enabled: true, dmPolicy: "open" }],
  ]) {
    it(`warns about an open slack: ${name}`, () => {
      const f = dmFindings(audit({ slack: conf }));
      assert.equal(f.length, 1, `slack ${name} produced no finding`);
      assert.equal(f[0].id, "channels.slack.dm");
      assert.equal(f[0].level, "warn");
      assert.ok(f[0].fix, "a finding with no remedy is not actionable");
      // The remedy must survive the trip through the audit, not just exist:
      // the audit used to hand every channel the same "Prefer pairing" string.
      assert.match(f[0].fix, /no pairing store/i, f[0].fix);
    });
  }

  it("stays quiet when slack gates its senders", () => {
    assert.equal(dmFindings(audit({ slack: { enabled: true, dmPolicy: "allowlist" } })).length, 0);
  });

  it("stays quiet about a disabled channel", () => {
    assert.equal(dmFindings(audit({ slack: { enabled: false } })).length, 0);
  });

  // Regression: the two rows the audit already got right.
  it("still warns on telegram dmPolicy=open", () => {
    const f = dmFindings(audit({ telegram: { enabled: true, dmPolicy: "open" } }));
    assert.equal(f[0]?.id, "channels.telegram.dm");
    assert.equal(f[0]?.level, "warn");
  });

  it("still stays quiet on a telegram that defaults to pairing", () => {
    assert.equal(dmFindings(audit({ telegram: { enabled: true } })).length, 0);
  });

  it("keeps a private copy of the channel list out of both readers", () => {
    const a = fs.readFileSync(new URL("../src/security/audit.mjs", import.meta.url), "utf8");
    assert.doesNotMatch(a, /for \(const ch of \[/, "audit re-enumerates the channels");
    assert.match(a, /DM_POSTURE|isOpenDm/);
    const d = fs.readFileSync(new URL("../src/cli/doctor.mjs", import.meta.url), "utf8");
    assert.match(d, /isOpenDm\(/, "doctor still uses its own dmPolicy predicate");
  });
});
