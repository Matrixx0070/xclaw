import { describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { saveCredentials, loadCredentials } from "../src/auth/xai.mjs";

/**
 * RULE(m) — per-file PERMISSION MODE is its own enforcement line.
 *
 * `saveCredentials` (src/auth/xai.mjs) writes the live xAI credential store
 * `<configDir>/credentials.json`. Unlike the token vault / connected-token
 * store, this module has NO encryption path at all: the xAI API key and any
 * OAuth access/refresh tokens are written with a plain `JSON.stringify(data)`.
 * The credential therefore always sits on disk in PLAINTEXT, and the file's
 * `0o600` (owner-only) permission mode is the *sole* barrier between a local,
 * non-root user and a bearer credential for the gateway's model provider.
 *
 * The mode is enforced by two lines: `writeFile(fp, …, { mode: 0o600 })` sets
 * it at *create* time (umask-masked, and a no-op when the file already exists),
 * and the following `fs.chmod(fp, 0o600)` re-asserts the exact mode on *every*
 * save. The chmod is the authoritative line — it is what keeps a rewrite of an
 * already-existing (or tampered) file owner-only.
 *
 * A prior sweep proved the blind spot: flipping that chmod to `0o644`
 * (world-readable) left the whole suite green — the store's mode was asserted
 * nowhere. These tests pin it: on the initial write, and on a rewrite after the
 * file was left group/world-readable (which only the chmod can repair), so a
 * regression to a readable mode is RED.
 */
describe("xai credential store file mode (RULE(m))", () => {
  async function tmpCfg() {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "xclaw-xaicred-"));
    return { cfg: { paths: { configDir: dir } }, fp: path.join(dir, "credentials.json") };
  }

  // A clearly-fake, non-functional key — never a real secret.
  const FAKE_KEY = "xai-test-000000000000000000000000fake";
  const FAKE_TOK = "test-access-token-000000000000fake";

  it("writes credentials.json 0o600, with the key in plaintext (no encryption path)", async () => {
    const { cfg, fp } = await tmpCfg();
    await saveCredentials(cfg, { xaiApiKey: FAKE_KEY, accessToken: FAKE_TOK });

    // Precondition that makes the mode load-bearing: the credential is NOT
    // encrypted at rest — it is the raw key/token sitting on disk.
    const parsed = JSON.parse(await fs.readFile(fp, "utf8"));
    assert.equal(parsed.xaiApiKey, FAKE_KEY, "expected the raw API key stored in plaintext");
    assert.equal(parsed.accessToken, FAKE_TOK, "expected the raw access token stored in plaintext");
    assert.equal(parsed.enc, undefined, "credential store must not claim to be encrypted");
    assert.equal(parsed.ciphertext, undefined, "credential store must be plaintext, not a ciphertext envelope");
    // loadCredentials round-trips the plaintext (confirms it really is the store).
    assert.equal((await loadCredentials(cfg)).xaiApiKey, FAKE_KEY);

    const mode = (await fs.stat(fp)).mode & 0o777;
    assert.equal(
      mode,
      0o600,
      `credential store must be 0o600 (owner-only); got 0o${mode.toString(8)} — a group/world-readable mode leaks the plaintext provider credential`,
    );
  });

  it("re-enforces 0o600 on a rewrite even if the file was left group/world-readable", async () => {
    const { cfg, fp } = await tmpCfg();
    await saveCredentials(cfg, { xaiApiKey: FAKE_KEY });

    // Simulate a pre-existing / tampered file that is world-readable. writeFile
    // on an existing file does NOT change its mode — only the chmod does.
    await fs.chmod(fp, 0o644);
    await saveCredentials(cfg, { xaiApiKey: FAKE_KEY + "2" });

    const mode = (await fs.stat(fp)).mode & 0o777;
    assert.equal(
      mode,
      0o600,
      `after a rewrite the store must be re-chmod'd to 0o600; got 0o${mode.toString(8)} — the authoritative chmod is the only line that repairs a readable file`,
    );
  });
});
