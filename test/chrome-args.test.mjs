import { describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  buildChromeArgs,
  chromeArgsInvariants,
} from "../src/computer/chrome-args.mjs";
import { resolveChromeArgs, loadChromeArgsModule } from "../src/computer/chrome-args-bridge.mjs";

describe("Phase A5 single Chrome args path", () => {
  it("buildChromeArgs requires userDataDir", () => {
    assert.throws(() => buildChromeArgs({}), /userDataDir/);
  });

  it("buildChromeArgs includes H0 invariants", () => {
    const args = buildChromeArgs({
      userDataDir: "/tmp/xclaw-test-profile",
      headless: true,
    });
    const inv = chromeArgsInvariants(args);
    assert.equal(inv.ok, true, JSON.stringify(inv.missing));
    assert.ok(args.includes("--headless=new") || args.some((a) => a.startsWith("--headless")));
    assert.ok(args.some((a) => a.startsWith("--user-data-dir=")));
  });

  it("headed mode drops headless and sets window", () => {
    const prev = process.env.XCLAW_BROWSER_HEADED;
    process.env.XCLAW_BROWSER_HEADED = "1";
    try {
      const args = buildChromeArgs({
        userDataDir: "/tmp/p",
        headless: true, // forced headed by env
      });
      assert.ok(!args.includes("--headless=new"));
      assert.ok(args.some((a) => a.startsWith("--window-size=")));
    } finally {
      if (prev === undefined) delete process.env.XCLAW_BROWSER_HEADED;
      else process.env.XCLAW_BROWSER_HEADED = prev;
    }
  });

  it("MITM adds proxy flags", () => {
    const prev = process.env.XCLAW_MITM;
    process.env.XCLAW_MITM = "1";
    try {
      const args = buildChromeArgs({ userDataDir: "/tmp/p", headless: true });
      assert.ok(args.some((a) => a.startsWith("--proxy-server=")));
      assert.ok(args.includes("--proxy-bypass-list=<-loopback>"));
    } finally {
      if (prev === undefined) delete process.env.XCLAW_MITM;
      else process.env.XCLAW_MITM = prev;
    }
  });

  it("bridge resolves same module", async () => {
    process.env.XCLAW_ROOT = process.cwd();
    const m = await loadChromeArgsModule();
    assert.ok(m?.buildChromeArgs);
    const args = await resolveChromeArgs(
      { userDataDir: "/tmp/bridge-p", headless: true },
      ["--stale"]
    );
    const inv = chromeArgsInvariants(args);
    assert.equal(inv.ok, true);
  });

});
