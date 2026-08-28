/**
 * RULE(o) sweep #73 — model-discovery URLs can embed the API key
 * (Google Gemini `/models?key=…`), and fetchLiveModels surfaced that
 * URL VERBATIM: persisted into the on-disk model cache, returned to
 * doctor's providers.liveCheck, and served by provider routes. The
 * request keeps the real key (the fetch needs it); every surfaced URL
 * is redacted. Old cache files may hold keys, so the stale-read path
 * redacts too.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { redactUrlSecrets } from "../src/utils/redact-url.mjs";
import { buildDiscoveryRequest, fetchLiveModels } from "../src/providers/discovery.mjs";

const FAKE_KEY = "AIza-FAKE-not-a-real-google-key-000001";

describe("discovery URL redaction (sweep #73)", () => {
  it("redactUrlSecrets strips secret query params and proxy userinfo, leaves clean URLs alone", () => {
    assert.equal(
      redactUrlSecrets(`https://g.example/models?key=${FAKE_KEY}&pageSize=100`),
      "https://g.example/models?key=<redacted>&pageSize=100",
    );
    assert.equal(
      redactUrlSecrets("https://x.example/a?api_key=S&token=T&access_token=U&other=ok"),
      "https://x.example/a?api_key=<redacted>&token=<redacted>&access_token=<redacted>&other=ok",
    );
    assert.equal(
      redactUrlSecrets("http://user:pass@proxy.example:8080/path"),
      "http://<redacted>@proxy.example:8080/path",
    );
    assert.equal(redactUrlSecrets("https://api.x.ai/v1/models"), "https://api.x.ai/v1/models");
    assert.equal(redactUrlSecrets(null), "");
  });

  it("the REQUEST keeps the real key (the fetch needs it) — redaction is egress-only", () => {
    const req = buildDiscoveryRequest("google", "https://compat.example/v1", FAKE_KEY);
    assert.ok(req.url.includes(`key=${encodeURIComponent(FAKE_KEY)}`), "request URL must carry the key");
    assert.equal(redactUrlSecrets(req.url).includes(FAKE_KEY), false);
  });

  it("a failed google discovery surfaces a REDACTED url — never the key (end to end)", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "xclaw-disc-"));
    try {
      const cfg = {
        paths: { configDir: dir },
        providers: { google: { apiKey: FAKE_KEY, baseUrl: "http://127.0.0.1:9" } },
      };
      const r = await fetchLiveModels(cfg, "google", { force: true, timeoutMs: 3000 });
      assert.ok(typeof r.url === "string" && r.url.length > 0, "a url is surfaced");
      assert.equal(r.url.includes(FAKE_KEY), false, "the key must never appear in the surfaced url");
      assert.match(r.url, /<redacted>/);
      // nothing on disk may hold the key either (cache is only written on
      // success, and success payloads are redacted at construction)
      const files = fs.existsSync(path.join(dir, "model-cache"))
        ? fs.readdirSync(path.join(dir, "model-cache"))
        : [];
      for (const f of files) {
        const body = fs.readFileSync(path.join(dir, "model-cache", f), "utf8");
        assert.equal(body.includes(FAKE_KEY), false, `key leaked into cache file ${f}`);
      }
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});
