import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { enforceProdHardening } from "../src/config/load.mjs";

describe("prod telegram dmPolicy", () => {
  it("forces open → pairing when no allowlist", () => {
    const prev = process.env.XCLAW_TELEGRAM_DM_POLICY;
    delete process.env.XCLAW_TELEGRAM_DM_POLICY;
    const out = enforceProdHardening({
      profile: "prod",
      channels: { telegram: { dmPolicy: "open" } },
    });
    assert.equal(out.channels.telegram.dmPolicy, "pairing");
    assert.ok(out._prodHardening.some((x) => x.includes("dmPolicy=pairing")));
    if (prev != null) process.env.XCLAW_TELEGRAM_DM_POLICY = prev;
  });

  it("forces open → allowlist when allowFrom set", () => {
    delete process.env.XCLAW_TELEGRAM_DM_POLICY;
    const out = enforceProdHardening({
      profile: "prod",
      channels: {
        telegram: { dmPolicy: "open", allowedChatIds: ["1"] },
      },
    });
    assert.equal(out.channels.telegram.dmPolicy, "allowlist");
  });

  it("lab leaves open alone", () => {
    const out = enforceProdHardening({
      profile: "lab",
      channels: { telegram: { dmPolicy: "open" } },
    });
    assert.equal(out.channels.telegram.dmPolicy, "open");
  });

  it("env can force open break-glass", () => {
    process.env.XCLAW_TELEGRAM_DM_POLICY = "open";
    const out = enforceProdHardening({
      profile: "prod",
      channels: { telegram: { dmPolicy: "pairing" } },
    });
    assert.equal(out.channels.telegram.dmPolicy, "open");
    delete process.env.XCLAW_TELEGRAM_DM_POLICY;
  });
});
