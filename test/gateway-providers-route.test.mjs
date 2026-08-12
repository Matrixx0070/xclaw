import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

// Isolate ALL config/profile writes: getConfigPath() resolves via os.homedir()
// (reads $HOME at call time) and the profile/cache stores honor
// cfg.paths.configDir / XCLAW_STATE_DIR. Point everything at a temp dir BEFORE
// importing the route module.
const TMP_HOME = fs.mkdtempSync(path.join(os.tmpdir(), "xclaw-prov-route-"));
const SAVED_HOME = process.env.HOME;
const SAVED_STATE = process.env.XCLAW_STATE_DIR;
process.env.HOME = TMP_HOME;
process.env.XCLAW_STATE_DIR = path.join(TMP_HOME, ".xclaw");

const { tryHandleProvidersRoute } = await import("../src/gateway/routes/providers.mjs");

after(() => {
  process.env.HOME = SAVED_HOME;
  if (SAVED_STATE === undefined) delete process.env.XCLAW_STATE_DIR;
  else process.env.XCLAW_STATE_DIR = SAVED_STATE;
  fs.rmSync(TMP_HOME, { recursive: true, force: true });
});

function makeArgs({ p, method = "GET", body = {}, cfg = {} }) {
  const out = { status: null, body: null };
  return {
    args: {
      p,
      method,
      req: { headers: {} },
      res: {},
      url: new URL(`http://local${p}`),
      cfg: { paths: { configDir: process.env.XCLAW_STATE_DIR }, ...cfg },
      json: (_res, status, payload) => {
        out.status = status;
        out.body = payload;
      },
      readBody: async () => body,
    },
    out,
  };
}

describe("gateway providers management routes", () => {
  it("GET /providers/manage returns the inventory shape (no secrets)", async () => {
    const { args, out } = makeArgs({ p: "/providers/manage" });
    const handled = await tryHandleProvidersRoute(args);
    assert.equal(handled, true);
    assert.equal(out.status, 200);
    assert.ok(out.body.active && "provider" in out.body.active);
    assert.ok(Array.isArray(out.body.providers) && out.body.providers.length > 5);
    const row = out.body.providers.find((r) => r.id === "ollama");
    assert.ok(row, "ollama row present");
    for (const field of ["baseUrl", "hasKey", "hasOAuth", "configured", "models"]) {
      assert.ok(field in row, `row.${field}`);
    }
    const dump = JSON.stringify(out.body);
    assert.ok(!/sk-ant-|xai-|apiKey|accessToken/.test(dump), "no secrets in inventory");
  });

  it("POST base-url persists and is reflected in a subsequent GET", async () => {
    const set = makeArgs({
      p: "/providers/manage/base-url",
      method: "POST",
      body: { provider: "ollama", url: "http://127.0.0.1:9999/v1" },
    });
    assert.equal(await tryHandleProvidersRoute(set.args), true);
    assert.equal(set.out.status, 200);
    assert.equal(set.out.body.baseUrl, "http://127.0.0.1:9999/v1");

    // persisted to the (temp) user config on disk
    const cfgFile = path.join(TMP_HOME, ".xclaw", "xclaw.json");
    const onDisk = JSON.parse(fs.readFileSync(cfgFile, "utf8"));
    assert.equal(onDisk.providers.ollama.baseUrl, "http://127.0.0.1:9999/v1");

    // reflected in inventory when cfg carries the same override
    const get = makeArgs({
      p: "/providers/manage",
      cfg: { providers: onDisk.providers },
    });
    assert.equal(await tryHandleProvidersRoute(get.args), true);
    const row = get.out.body.providers.find((r) => r.id === "ollama");
    assert.equal(row.baseUrl, "http://127.0.0.1:9999/v1");
    assert.equal(row.baseUrlCustom, true);

    // clear it
    const clear = makeArgs({
      p: "/providers/manage/base-url",
      method: "POST",
      body: { provider: "ollama", url: null },
    });
    assert.equal(await tryHandleProvidersRoute(clear.args), true);
    const after = JSON.parse(fs.readFileSync(cfgFile, "utf8"));
    assert.equal(after.providers.ollama.baseUrl, null);
  });

  it("POST use writes the active provider/model to disk", async () => {
    const { args, out } = makeArgs({
      p: "/providers/manage/use",
      method: "POST",
      body: { provider: "ollama", model: "llama3.3" },
    });
    assert.equal(await tryHandleProvidersRoute(args), true);
    assert.equal(out.status, 200);
    assert.equal(out.body.provider, "ollama");
    assert.equal(out.body.model, "llama3.3");
    assert.match(out.body.note || "", /new agent runs/);
    const onDisk = JSON.parse(
      fs.readFileSync(path.join(TMP_HOME, ".xclaw", "xclaw.json"), "utf8")
    );
    assert.equal(onDisk.agent.provider, "ollama");
    assert.equal(onDisk.agent.model, "llama3.3");
    assert.equal(onDisk.agent.baseUrl, null);
  });

  it("POST key stores a profile without echoing the secret", async () => {
    const { args, out } = makeArgs({
      p: "/providers/manage/key",
      method: "POST",
      body: { provider: "groq", apiKey: "gsk_test_secret_value" },
    });
    assert.equal(await tryHandleProvidersRoute(args), true);
    assert.equal(out.status, 200);
    assert.ok(!JSON.stringify(out.body).includes("gsk_test_secret_value"), "secret not echoed");
    // now visible as hasKey in inventory
    const get = makeArgs({ p: "/providers/manage" });
    await tryHandleProvidersRoute(get.args);
    const row = get.out.body.providers.find((r) => r.id === "groq");
    assert.equal(row.hasKey, true);
    assert.equal(row.configured, true);
  });

  it("POST models returns ok:false cleanly when the provider is unreachable", async () => {
    const { args, out } = makeArgs({
      p: "/providers/manage/models",
      method: "POST",
      // ollama base was cleared back to the default 127.0.0.1:11434 in the temp
      // config; point it at a dead port through cfg to force a clean failure.
      body: { provider: "ollama" },
      cfg: { providers: { ollama: { baseUrl: "http://127.0.0.1:1" } } },
    });
    assert.equal(await tryHandleProvidersRoute(args), true);
    assert.equal(out.status, 200);
    assert.equal(out.body.ok, false);
    assert.ok(Array.isArray(out.body.models));
    assert.equal(out.body.models.length, 0);
    assert.ok(out.body.error, "error surfaced");
  });

  it("base-url validation: https any host + loopback http only", async () => {
    const cases = [
      ["http://evil.example/steal", false],
      ["file:///etc/passwd", false],
      ["ftp://x/", false],
      ["http://10.0.0.5:11434/v1", false],
      ["https://api.example.com/v1", true],
      ["http://127.0.0.1:11434/v1", true],
      ["http://localhost:8080/v1", true],
    ];
    for (const [url, okExpected] of cases) {
      const { args, out } = makeArgs({
        p: "/providers/manage/base-url",
        method: "POST",
        body: { provider: "ollama", url },
      });
      assert.equal(await tryHandleProvidersRoute(args), true, url);
      assert.equal(out.status, okExpected ? 200 : 400, `${url} → ${out.status}`);
      if (!okExpected) assert.ok(out.body.error, `${url} error surfaced`);
    }
    // reset for later tests
    const clear = makeArgs({
      p: "/providers/manage/base-url",
      method: "POST",
      body: { provider: "ollama", url: null },
    });
    await tryHandleProvidersRoute(clear.args);
    assert.equal(clear.out.status, 200);
  });

  it("api-key and oauth are separate profiles; prefer reorders", async () => {
    // fake an OAuth profile at groq:default alongside the groq:apikey from above
    const { loginOAuthTokens, listProfiles } = await import("../src/auth/profiles.mjs");
    const cfg = { paths: { configDir: process.env.XCLAW_STATE_DIR } };
    await loginOAuthTokens(cfg, {
      provider: "groq",
      name: "default",
      accessToken: "fake-oauth-token",
      expiresIn: 3600,
    });
    const profiles = await listProfiles(cfg, "groq");
    const ids = profiles.map((p) => p.id).sort();
    assert.deepEqual(ids, ["groq:apikey", "groq:default"], "both credentials coexist");

    const prefer = makeArgs({
      p: "/providers/manage/prefer",
      method: "POST",
      body: { provider: "groq", profileId: "groq:apikey" },
    });
    assert.equal(await tryHandleProvidersRoute(prefer.args), true);
    assert.equal(prefer.out.status, 200);
    assert.equal(prefer.out.body.order[0], "groq:apikey");

    // inventory reflects both profiles with modes
    const get = makeArgs({ p: "/providers/manage" });
    await tryHandleProvidersRoute(get.args);
    const row = get.out.body.providers.find((r) => r.id === "groq");
    const modes = row.profiles.map((p) => p.mode).sort();
    assert.ok(row.profiles.length === 2, "two profiles in inventory");
    assert.ok(modes.includes("oauth"), "oauth profile visible");
  });

  it("throwing handler → 400 with error (unknown provider on use)", async () => {
    const { args, out } = makeArgs({
      p: "/providers/manage/use",
      method: "POST",
      body: { provider: "definitely-not-a-provider" },
    });
    assert.equal(await tryHandleProvidersRoute(args), true);
    assert.equal(out.status, 400);
    assert.match(out.body.error, /unknown provider/);
  });

  it("unmatched paths return false", async () => {
    const { args } = makeArgs({ p: "/providers/route" });
    assert.equal(await tryHandleProvidersRoute(args), false);
    const other = makeArgs({ p: "/definitely/not" });
    assert.equal(await tryHandleProvidersRoute(other.args), false);
  });
});
