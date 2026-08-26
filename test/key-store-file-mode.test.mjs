import { describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { ensureKeyStore, rotateKeys } from "../src/auth/key-rotation.mjs";

/**
 * RULE(m) — per-file PERMISSION MODE is its own enforcement line.
 *
 * The signing-key store (`<configDir>/key-rotation.json`) holds the gateway's
 * EC P-256 *private* signing key. It is encrypted at rest only when a key
 * secret is configured (`auth.keys.secret` / `XCLAW_KEY_SECRET`); with no
 * secret — the default — the private JWK sits on disk in PLAINTEXT
 * (`privateBlob.enc === false`). In that state the file's `0o600` (owner-only)
 * permission mode is the *sole* barrier between a local, non-root user and a
 * key that forges any gateway JWT. `writeStore` in src/auth/key-rotation.mjs
 * requests `mode: 0o600`, and durable-write chmods to exactly that.
 *
 * A prior sweep proved the blind spot: flipping that shipping line to `0o644`
 * (world-readable) left the whole suite green — the mode was asserted nowhere.
 * These tests pin it, both on the initial `ensureKeyStore` write and across a
 * `rotateKeys` rewrite, so a regression to a group/world-readable mode is RED.
 */
describe("signing-key store file mode (RULE(m))", () => {
  async function tmpCfg(extra = {}) {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "xclaw-krmode-"));
    const cfg = {
      paths: { configDir: dir },
      auth: {
        keys: {
          rotationStrategy: "dual_slot",
          dualWindowMs: 60_000,
          autoRotate: false,
          ...extra,
        },
      },
    };
    return { cfg, storePath: path.join(dir, "key-rotation.json") };
  }

  it("ensureKeyStore writes the private-key store 0o600, with the key in plaintext by default", async () => {
    const { cfg, storePath } = await tmpCfg(); // no auth.keys.secret set
    await ensureKeyStore(cfg);

    // Precondition that makes the mode load-bearing: the private key is NOT
    // encrypted at rest — it is the raw JWK `d` component sitting on disk.
    const raw = JSON.parse(await fs.readFile(storePath, "utf8"));
    assert.equal(
      raw.privateBlob?.enc,
      false,
      "expected the default (no-secret) store to keep the private key in plaintext",
    );
    assert.ok(
      typeof raw.privateBlob?.jwk?.d === "string" && raw.privateBlob.jwk.d.length > 0,
      "expected the plaintext private JWK `d` component on disk",
    );

    const mode = (await fs.stat(storePath)).mode & 0o777;
    assert.equal(
      mode,
      0o600,
      `signing-key store must be 0o600 (owner-only); got 0o${mode.toString(8)} — a group/world-readable mode leaks the plaintext private signing key`,
    );
  });

  it("keeps 0o600 across a rotateKeys rewrite", async () => {
    const { cfg, storePath } = await tmpCfg();
    await ensureKeyStore(cfg);
    const r = await rotateKeys(cfg, { reason: "test" });
    assert.equal(r.ok, true);

    const mode = (await fs.stat(storePath)).mode & 0o777;
    assert.equal(
      mode,
      0o600,
      `after rotate the store must stay 0o600; got 0o${mode.toString(8)}`,
    );
  });
});
