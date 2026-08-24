import { describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import { existsSync } from "node:fs";

const fsExistsDockerenv = () => existsSync("/.dockerenv");
import os from "node:os";
import path from "node:path";
import {
  buildChromeArgs,
  chromeArgsInvariants,
} from "../src/computer/chrome-args.mjs";

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

  // Regression: on a root-run host Chrome exits before the CDP port opens
  // unless --no-sandbox is passed — the live bot's browser was dead with
  // "Browser exited before getting port" until root detection was added.
  it("root uid forces --no-sandbox", () => {
    const orig = process.getuid;
    try {
      process.getuid = () => 0;
      const args = buildChromeArgs({ userDataDir: "/tmp/root-p", headless: true });
      assert.ok(args.includes("--no-sandbox"));
    } finally {
      if (orig) process.getuid = orig;
      else delete process.getuid;
    }
  });

  it("non-root without overrides keeps the sandbox", () => {
    const orig = process.getuid;
    const envKeys = ["XCLAW_BROWSER_NO_SANDBOX", "CI", "XCLAW_IN_DOCKER"];
    const saved = envKeys.map((k) => [k, process.env[k]]);
    try {
      process.getuid = () => 1000;
      for (const k of envKeys) delete process.env[k];
      const args = buildChromeArgs({ userDataDir: "/tmp/user-p", headless: true });
      // /.dockerenv may exist in containerized CI — only assert when it doesn't
      if (!fsExistsDockerenv()) assert.equal(args.includes("--no-sandbox"), false);
    } finally {
      if (orig) process.getuid = orig;
      else delete process.getuid;
      for (const [k, v] of saved) if (v !== undefined) process.env[k] = v;
    }
  });

});
