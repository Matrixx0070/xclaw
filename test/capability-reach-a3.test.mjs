import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  resolveReach,
  formatCapabilityBanner,
  cdpAttachCommand,
  operatorNodeEnvExample,
} from "../src/agent/capability-reach.mjs";

describe("A3 capability reach", () => {
  it("resolveReach reads CDP from env", () => {
    const prev = process.env.XCLAW_CDP_URL;
    process.env.XCLAW_CDP_URL = "http://127.0.0.1:9222";
    try {
      const r = resolveReach({ computer: { engine: "native" } });
      assert.equal(r.cdpAttach, true);
      assert.equal(r.cdpUrl, "http://127.0.0.1:9222");
      assert.equal(r.engine, "bundle", "retired selectors resolve, never pass through");
    } finally {
      if (prev === undefined) delete process.env.XCLAW_CDP_URL;
      else process.env.XCLAW_CDP_URL = prev;
    }
  });

  it("banner is honest when no CDP", () => {
    const prev = process.env.XCLAW_CDP_URL;
    delete process.env.XCLAW_CDP_URL;
    try {
      const r = resolveReach({ computer: { engine: "native", cdpUrl: null } });
      const b = formatCapabilityBanner(r);
      assert.match(b, /CDP attach: none/);
      assert.match(b, /cannot see the user's desktop/i);
      assert.match(b, /remote-debugging-port/);
    } finally {
      if (prev !== undefined) process.env.XCLAW_CDP_URL = prev;
    }
  });

  it("cdpAttachCommand documents port", () => {
    assert.match(cdpAttachCommand(9222), /9222/);
    assert.match(cdpAttachCommand(9333), /9333/);
  });

  it("operatorNodeEnvExample mentions profile and CDP", () => {
    const s = operatorNodeEnvExample();
    assert.match(s, /XCLAW_PROFILE/);
    assert.match(s, /XCLAW_CDP_URL/);
  });

  it("fullBrowser true for bundle engine", () => {
    const prev = process.env.XCLAW_COMPUTER_ENGINE;
    delete process.env.XCLAW_COMPUTER_ENGINE;
    try {
      const r = resolveReach({ computer: { engine: "bundle" } });
      assert.equal(r.fullBrowser, true);
    } finally {
      if (prev !== undefined) process.env.XCLAW_COMPUTER_ENGINE = prev;
    }
  });

  // ADR 0006 promises a deployment carrying a retired selector keeps working
  // unchanged. The banner used to pass the selector through instead of
  // resolving it, so such a node advertised screenshot:false / fullBrowser:false
  // and the agent stopped attempting two capabilities the bundle has.
  for (const legacy of ["native", "thin", "generated", "c3"]) {
    it(`retired selector "${legacy}" does not deny bundle capabilities`, () => {
      const prevEng = process.env.XCLAW_COMPUTER_ENGINE;
      const prevCdp = process.env.XCLAW_CDP_URL;
      delete process.env.XCLAW_COMPUTER_ENGINE;
      delete process.env.XCLAW_CDP_URL; // no attach: capabilities must come from the engine alone
      try {
        const r = resolveReach({ computer: { engine: legacy } });
        assert.equal(r.engine, "bundle");
        assert.equal(r.screenshot, true);
        assert.equal(r.fullBrowser, true);
      } finally {
        if (prevEng !== undefined) process.env.XCLAW_COMPUTER_ENGINE = prevEng;
        if (prevCdp !== undefined) process.env.XCLAW_CDP_URL = prevCdp;
      }
    });
  }
});
