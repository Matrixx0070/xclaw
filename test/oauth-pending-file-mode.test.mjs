/**
 * RULE(m) file-mode pin + hardening — oauth-pending.json permission invariant.
 *
 * The pending-PKCE store `~/.xclaw/oauth-pending.json` holds the OAuth
 * `code_verifier` (record.verifier) in cleartext — there is NO encryption code
 * path in connected/oauth-pending.mjs, so the 0o600 file mode is the SOLE
 * at-rest control on the PKCE secret. It must be group/other-unreadable.
 *
 * The authenticator's *decisions* are pinned by oauth-pending-state.test.mjs
 * (accept-once / reject-forged / single-use / reject-expired). NONE of those
 * assert the file MODE — a RULE(m) blind spot: a per-file permission mode is its
 * own enforcement line, distinct from "the file exists / round-trips".
 *
 * The latent defect (sweep #60, the #59 sibling): both writers set the mode
 * create-only and never re-tighten on rewrite.
 *   - createPending (line 36): `writeFile(fp, ..., { mode: 0o600 })` — the mode
 *     argument is honoured only when the file is *created*. oauth-pending.json
 *     persists across concurrent in-flight logins, so every subsequent write is
 *     an in-place rewrite of an existing inode: if that inode was ever created
 *     at a looser mode (older build, restore, a umask'd sibling path), the mode
 *     stays loose forever.
 *   - takePending (line 52): `writeFile(fp, ...)` with NO mode at all — it can
 *     only ever preserve the existing perms.
 * The fix mirrors the proven #58/#59 pattern (xai.mjs saveCredentials /
 * xai-oauth.mjs writeTokens): a `chmod(fp, 0o600)` after each write so the mode
 * invariant holds on every rewrite regardless of the file's prior mode.
 *
 * Mutation check: with the chmod removed from either writer, the matching case
 * below goes RED (the file stays at the looser 0o644 it was seeded with);
 * with the chmod present, GREEN.
 */
import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import {
  createPending,
  takePending,
} from "../src/connected/oauth-pending.mjs";

let TMP;
let cfg;
let fp;
beforeEach(() => {
  TMP = fs.mkdtempSync(path.join(os.tmpdir(), "xclaw-oauth-pending-mode-"));
  cfg = { paths: { configDir: TMP } };
  fp = path.join(TMP, "oauth-pending.json");
});
afterEach(() => {
  fs.rmSync(TMP, { recursive: true, force: true });
});

const record = (over = {}) => ({
  appId: "acme",
  tokenUrl: "https://idp.example/token",
  clientId: "cid",
  verifier: "pkce-verifier-secret",
  ...over,
});

const modeOf = (p) => fs.statSync(p).mode & 0o777;

describe("oauth-pending.json — 0o600 file-mode invariant (RULE(m))", () => {
  it("createPending re-tightens a pre-existing looser-mode store to 0o600", async () => {
    // Seed the store as an older/looser build would have left it: the file
    // already exists at 0o644 before this login begins.
    fs.mkdirSync(TMP, { recursive: true });
    fs.writeFileSync(fp, JSON.stringify({}), { mode: 0o644 });
    fs.chmodSync(fp, 0o644); // defeat umask — force the loose starting mode
    assert.equal(modeOf(fp), 0o644, "precondition: store starts world-readable");

    await createPending(cfg, record());

    // createPending rewrote the existing inode. The create-only writeFile mode
    // cannot re-tighten it; only an explicit chmod can.
    assert.equal(
      modeOf(fp),
      0o600,
      "createPending must chmod the store to 0o600 on rewrite, not leave the PKCE verifier world-readable",
    );
  });

  it("takePending keeps the store at 0o600 after consuming a state", async () => {
    const { state } = await createPending(cfg, record());
    // Simulate the inode having drifted looser between writes.
    fs.chmodSync(fp, 0o644);
    assert.equal(modeOf(fp), 0o644, "precondition: store drifted world-readable");

    const got = await takePending(cfg, state);
    assert.ok(got, "the genuine state must still be consumed");
    assert.equal(
      modeOf(fp),
      0o600,
      "takePending's rewrite must re-tighten the store to 0o600",
    );
  });

  it("a fresh createPending creates the store at 0o600", async () => {
    // The happy path: no pre-existing file. Pins the create-time mode so a
    // future edit dropping `{ mode: 0o600 }` from createPending is caught even
    // on first creation.
    await createPending(cfg, record());
    assert.equal(modeOf(fp), 0o600, "a freshly created store must be 0o600");
  });
});
