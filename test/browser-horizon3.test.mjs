import { describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  fittsDuration,
  fittsID,
  readingPause,
  mousePath,
  humanize,
} from "../src/browser/humanize.mjs";
import {
  sanitizeOriginHost,
  resolveOriginProfile,
  listOriginProfiles,
} from "../src/browser/profile.mjs";

describe("Horizon 3 Motor + Identity", () => {
  it("fittsID grows with distance and shrinks with width", () => {
    const far = fittsID(800, 20);
    const near = fittsID(40, 20);
    const fat = fittsID(800, 120);
    assert.ok(far > near);
    assert.ok(far > fat);
  });

  it("fittsDuration is longer for hard targets", () => {
    // Disable humanize variance for stable compare — still uses clamp
    const hard = fittsDuration(900, 12);
    const easy = fittsDuration(40, 80);
    assert.ok(hard > easy);
    assert.ok(hard >= 40 && hard <= 2500);
  });

  it("mousePath with targetWidth uses Fitts-scale delays", () => {
    const path = mousePath(0, 0, 500, 0, { targetWidth: 20 });
    assert.ok(path.length > 5);
    const total = path.reduce((s, p) => s + (p.delayMs || 0), 0);
    // should be non-trivial duration when humanize enabled
    if (humanize.enabled) {
      assert.ok(total > 30);
    }
    const last = path[path.length - 1];
    assert.ok(Math.abs(last.x - 500) < 30 || last.x === 500);
  });

  it("readingPause scales with text length", () => {
    if (!humanize.enabled) return;
    const short = readingPause("hi");
    const long = readingPause("x".repeat(400));
    assert.ok(long >= short);
  });

  it("sanitizeOriginHost normalizes URLs", () => {
    assert.equal(sanitizeOriginHost("https://Shop.Example.com:443/path"), "shop.example.com");
    assert.equal(sanitizeOriginHost("localhost"), "local");
    assert.equal(sanitizeOriginHost("127.0.0.1"), "local");
  });

  it("resolveOriginProfile creates origin dir when mode=origin", async () => {
    const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "xclaw-orig-"));
    try {
      const dir = await resolveOriginProfile("https://pay.example.com", {
        mode: "origin",
        vaultDir: tmp,
      });
      assert.ok(dir.includes("pay.example.com"));
      const st = await fs.stat(path.join(dir, "Default"));
      assert.ok(st.isDirectory());
    } finally {
      await fs.rm(tmp, { recursive: true, force: true });
    }
  });

  it("resolveOriginProfile shared mode uses resolveProfileDir path", async () => {
    const prev = process.env.XCLAW_BROWSER_PROFILE_MODE;
    process.env.XCLAW_BROWSER_PROFILE_MODE = "shared";
    try {
      const dir = await resolveOriginProfile("https://a.com", { mode: "shared" });
      assert.ok(typeof dir === "string" && dir.length > 0);
    } finally {
      if (prev === undefined) delete process.env.XCLAW_BROWSER_PROFILE_MODE;
      else process.env.XCLAW_BROWSER_PROFILE_MODE = prev;
    }
  });

  it("listOriginProfiles returns array", async () => {
    const list = await listOriginProfiles({ root: path.join(os.tmpdir(), "no-such-origins-xclaw") });
    assert.ok(Array.isArray(list));
  });
});
