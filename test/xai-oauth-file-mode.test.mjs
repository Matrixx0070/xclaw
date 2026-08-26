import { describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { refreshXaiToken } from "../src/auth/xai-oauth.mjs";

/**
 * RULE(m) — per-file PERMISSION MODE is its own enforcement line.
 *
 * `writeTokens` (src/auth/xai-oauth.mjs) persists the xAI *OAuth* token vault
 * `<configDir>/auth.json` — the store written by every device-code, PKCE-
 * loopback, refresh, and Grok-CLI-import flow. Like its API-key sibling
 * (src/auth/xai.mjs), this module has NO encryption path: the OAuth
 * `access_token` and `refresh_token` are written with a plain
 * `JSON.stringify(data)` and sit on disk in PLAINTEXT. The file's `0o600`
 * (owner-only) permission mode is therefore the *sole* barrier between a local,
 * non-root user and a live bearer + refresh credential for the model provider.
 *
 * The mode is enforced by two lines: `writeFile(…, { mode: 0o600 })` sets it at
 * *create* time (umask-masked, and a no-op when the file already exists), and
 * the following `fs.chmod(tokenPath, 0o600)` re-asserts the exact mode on
 * *every* save. The chmod is the authoritative line — it is what keeps a
 * rewrite of an already-existing (or tampered) file owner-only.
 *
 * Sweep #59 proved the blind spot: flipping the create-time mode to `0o644`
 * (world-readable) left the whole suite green — the vault's mode was asserted
 * nowhere, and the store lacked the re-chmod its API-key sibling already had.
 * These tests pin it: on the initial write, and on a rewrite after the file was
 * left group/world-readable (which only the chmod can repair), so a regression
 * to a readable mode is RED.
 */
describe("xai OAuth token vault file mode (RULE(m))", () => {
  async function tmpCfg() {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "xclaw-xaioauth-"));
    return { cfg: { paths: { configDir: dir } }, fp: path.join(dir, "auth.json") };
  }

  // Clearly-fake, non-functional tokens — never real secrets.
  const FAKE_AT = "at-test-000000000000000000000000fake";
  const FAKE_RT = "rt-test-000000000000000000000000fake";

  const REFRESH_BODY = {
    access_token: FAKE_AT,
    refresh_token: FAKE_RT + "2",
    token_type: "Bearer",
    expires_in: 3600,
  };

  // Stub global.fetch so refreshXaiToken writes the vault with no network.
  async function withStubbedRefresh(body, fn) {
    const realFetch = global.fetch;
    global.fetch = async () => ({
      ok: true,
      json: async () => body,
      text: async () => JSON.stringify(body),
    });
    try {
      return await fn();
    } finally {
      global.fetch = realFetch;
    }
  }

  it("writes auth.json 0o600, with the OAuth tokens in plaintext (no encryption path)", async () => {
    const { cfg, fp } = await tmpCfg();
    await withStubbedRefresh(REFRESH_BODY, () =>
      refreshXaiToken({ refresh_token: FAKE_RT }, cfg),
    );

    // Precondition that makes the mode load-bearing: the tokens are NOT
    // encrypted at rest — they are the raw bearer/refresh credential on disk.
    const parsed = JSON.parse(await fs.readFile(fp, "utf8"));
    assert.equal(parsed.access_token, FAKE_AT, "expected the raw access token stored in plaintext");
    assert.equal(parsed.refresh_token, FAKE_RT + "2", "expected the raw refresh token stored in plaintext");
    assert.equal(parsed.enc, undefined, "token vault must not claim to be encrypted");
    assert.equal(parsed.ciphertext, undefined, "token vault must be plaintext, not a ciphertext envelope");

    const mode = (await fs.stat(fp)).mode & 0o777;
    assert.equal(
      mode,
      0o600,
      `OAuth token vault must be 0o600 (owner-only); got 0o${mode.toString(8)} — a group/world-readable mode leaks the plaintext provider bearer + refresh credential`,
    );
  });

  it("re-enforces 0o600 on a rewrite even if the file was left group/world-readable", async () => {
    const { cfg, fp } = await tmpCfg();
    await withStubbedRefresh(REFRESH_BODY, () =>
      refreshXaiToken({ refresh_token: FAKE_RT }, cfg),
    );

    // Simulate a pre-existing / tampered file that is world-readable. writeFile
    // on an existing file does NOT change its mode — only the chmod does.
    await fs.chmod(fp, 0o644);
    await withStubbedRefresh(REFRESH_BODY, () =>
      refreshXaiToken({ refresh_token: FAKE_RT }, cfg),
    );

    const mode = (await fs.stat(fp)).mode & 0o777;
    assert.equal(
      mode,
      0o600,
      `after a rewrite the vault must be re-chmod'd to 0o600; got 0o${mode.toString(8)} — the authoritative chmod is the only line that repairs a readable file`,
    );
  });
});
