import { describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  buildProductionChromeArgs,
  acquireDurableProfileLock,
  releaseDurableProfileLock,
  rotateFileIfLarge,
  horizon0Checklist,
} from "../src/browser/horizon0.mjs";

describe("Horizon 0 production foundations", () => {
  it("buildProductionChromeArgs includes CDP origins and dev-shm", () => {
    const args = buildProductionChromeArgs({
      userDataDir: "/tmp/xclaw-profile",
      headless: true,
    });
    assert.ok(args.includes("--remote-allow-origins=*"));
    assert.ok(args.includes("--disable-dev-shm-usage"));
    assert.ok(args.includes("--disable-crash-reporter"));
    assert.ok(args.some((a) => a.startsWith("--user-data-dir=")));
    assert.ok(args.includes("--headless=new"));
  });

  it("headed mode sets window geometry", () => {
    const prev = process.env.XCLAW_BROWSER_HEADED;
    process.env.XCLAW_BROWSER_HEADED = "1";
    try {
      const args = buildProductionChromeArgs({
        userDataDir: "/tmp/xclaw-profile",
        headless: true, // overridden by env
      });
      assert.ok(!args.includes("--headless=new"));
      assert.ok(args.some((a) => a.startsWith("--window-size=")));
    } finally {
      if (prev === undefined) delete process.env.XCLAW_BROWSER_HEADED;
      else process.env.XCLAW_BROWSER_HEADED = prev;
    }
  });

  it("MITM env adds proxy + loopback bypass", () => {
    const prev = process.env.XCLAW_MITM;
    process.env.XCLAW_MITM = "true";
    delete process.env.XCLAW_CHROME_MITM_ARGS;
    try {
      const args = buildProductionChromeArgs({
        userDataDir: "/tmp/xclaw-profile",
      });
      assert.ok(args.some((a) => a.startsWith("--proxy-server=")));
      assert.ok(args.includes("--proxy-bypass-list=<-loopback>"));
    } finally {
      if (prev === undefined) delete process.env.XCLAW_MITM;
      else process.env.XCLAW_MITM = prev;
    }
  });

  it("profile lock exclusive + reclaim dead pid", async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "xclaw-h0-lock-"));
    try {
      const a = await acquireDurableProfileLock(dir, { pid: process.pid });
      assert.equal(a.ok, true);
      const b = await acquireDurableProfileLock(dir, { pid: process.pid + 1 });
      assert.equal(b.ok, false);
      await releaseDurableProfileLock(a.lockPath);
      const c = await acquireDurableProfileLock(dir, { pid: process.pid });
      assert.equal(c.ok, true);
      await releaseDurableProfileLock(c.lockPath);
    } finally {
      await fs.rm(dir, { recursive: true, force: true });
    }
  });

  it("rotateFileIfLarge archives oversized logs", async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "xclaw-h0-rot-"));
    const file = path.join(dir, "flows.jsonl");
    await fs.writeFile(file, "x".repeat(1000));
    const r1 = await rotateFileIfLarge(file, { maxBytes: 5000, keep: 2 });
    assert.equal(r1.rotated, false);
    await fs.writeFile(file, "y".repeat(6000));
    const r2 = await rotateFileIfLarge(file, { maxBytes: 5000, keep: 2 });
    assert.equal(r2.rotated, true);
    assert.ok(r2.archive);
    await fs.rm(dir, { recursive: true, force: true });
  });

  it("horizon0Checklist returns core ids", () => {
    const list = horizon0Checklist({});
    const ids = list.map((x) => x.id);
    assert.ok(ids.includes("profile"));
    assert.ok(ids.includes("mitm"));
    assert.ok(ids.includes("cdp_origins"));
    assert.ok(ids.includes("dev_shm"));
  });
});
