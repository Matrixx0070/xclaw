import { describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import {
  sanitizeCookieHeader,
  sanitizeAuthorization,
  redactSecret,
  importWebSession,
  loadWebSession,
  clearWebSession,
  webSessionStatus,
} from "../src/auth/web-login.mjs";

describe("secure cookie handling", () => {
  it("rejects CR/LF in cookie", () => {
    assert.throws(() => sanitizeCookieHeader("a=b\r\nSet-Cookie: x=y"));
  });

  it("rejects oversized cookie", () => {
    assert.throws(() => sanitizeCookieHeader("x=" + "y".repeat(20_000)));
  });

  it("normalizes cookie pairs", () => {
    const s = sanitizeCookieHeader("  a=1;  b=2  ");
    assert.equal(s, "a=1; b=2");
  });

  it("redacts secrets", () => {
    const r = redactSecret("abcdefghijklmnopqrstuvwxyz");
    assert.ok(!r.includes("abcdefghijklmnop"));
    assert.ok(r.includes("len="));
  });

  it("sanitizes bearer", () => {
    assert.equal(
      sanitizeAuthorization("tok_abc"),
      "Bearer tok_abc"
    );
  });

  it("encrypts at rest and loads", async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "xclaw-web-"));
    const cfg = {
      paths: { configDir: dir },
      auth: { web: { sessionSecret: "test-secret-at-least-16-chars" } },
    };
    const imp = await importWebSession(cfg, {
      cookie: "session=abc123; other=xyz",
    });
    assert.equal(imp.ok, true);
    assert.equal(imp.encrypted, true);

    const raw = await fs.readFile(
      path.join(dir, "web-session.json"),
      "utf8"
    );
    assert.ok(!raw.includes("abc123"));
    assert.ok(raw.includes("aes-256-gcm"));

    const loaded = await loadWebSession(cfg);
    assert.equal(loaded.cookie, "session=abc123; other=xyz");

    const st = await webSessionStatus(cfg);
    assert.equal(st.present, true);
    assert.ok(!String(st.cookie).includes("abc123"));

    await clearWebSession(cfg);
    assert.equal(await loadWebSession(cfg), null);
  });
});
