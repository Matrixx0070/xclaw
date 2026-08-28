/**
 * The WebAuthn ceremony is two round trips, and only the FIRST half of each was
 * invocable: `register-options` and `assert-options` issued a challenge, and
 * `completeRegistration` / `completeAssertion` — the halves that consume it —
 * had no CLI action and no production caller at all. So no credential could
 * ever be registered on a real host (`status` reported `registered: 0` after
 * `register-options`, live), and `gateWithWebAuthn`'s remedy string,
 * "xclaw auth webauthn register", named a command that did not exist.
 *
 * Wiring the missing half is only safe because `completeAssertion` now verifies
 * the signature (test/webauthn-assertion-signature.test.mjs). In the order the
 * other way round it would have shipped an auth bypass: the finish it was
 * missing accepted any assertion at all.
 *
 * These drive the whole protocol through a real argv on an isolated HOME —
 * a handler that exists is not a handler that can be reached.
 */
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, readFileSync } from "node:fs";
import { execFile } from "node:child_process";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import path from "node:path";
import os from "node:os";
import crypto from "node:crypto";
import { webauthnBrowserSnippet } from "../src/auth/webauthn.mjs";

const execFileP = promisify(execFile);
const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const CLI = path.join(REPO, "bin", "xclaw.mjs");

const b64url = (b) => Buffer.from(b).toString("base64url");

/** First run in a fresh HOME prints a "[xclaw] Created config" banner before the JSON. */
const json = (stdout) => JSON.parse(stdout.slice(stdout.indexOf("{")));

/** rpIdHash(32) | flags(1) | signCount(4) — what an authenticator actually signs over. */
function authData(rpId, counter) {
  const b = Buffer.alloc(37);
  crypto.createHash("sha256").update(rpId).digest().copy(b, 0);
  b[32] = 0x05; // UP | UV
  b.writeUInt32BE(counter, 33);
  return b;
}

describe("xclaw auth webauthn — the ceremony has an invocable second half", () => {
  // getConfigDir() is homedir()-derived with no env override, so an isolated
  // HOME is the only way to keep this off the operator's real ~/.xclaw.
  const home = mkdtempSync(path.join(os.tmpdir(), "xclaw-wa-cli-"));
  const run = (args, stdin) =>
    new Promise((resolve) => {
      const child = execFile(
        process.execPath,
        [CLI, ...args],
        {
          env: { ...process.env, HOME: home, XDG_CONFIG_HOME: path.join(home, ".config") },
          timeout: 60_000,
        },
        (e, stdout, stderr) =>
          resolve({ code: e ? (e.code ?? 1) : 0, stdout: stdout || "", stderr: stderr || "" })
      );
      if (stdin != null) child.stdin.end(stdin);
    });

  const { privateKey, publicKey } = crypto.generateKeyPairSync("ec", { namedCurve: "P-256" });
  const spki = b64url(publicKey.export({ type: "spki", format: "der" }));
  const CRED = "cli-cred-1";

  test("register-options then register stores a credential", async () => {
    const opts = await run(["auth", "webauthn", "register-options"]);
    assert.equal(opts.code, 0, opts.stderr.slice(0, 300));
    const challenge = json(opts.stdout).publicKey.challenge;

    const payload = path.join(home, "reg.json");
    writeFileSync(
      payload,
      JSON.stringify({
        id: CRED,
        publicKey: spki,
        clientDataJSON: b64url(
          JSON.stringify({ type: "webauthn.create", challenge, origin: "https://localhost" })
        ),
      })
    );
    const reg = await run(["auth", "webauthn", "register", payload]);
    assert.equal(reg.code, 0, `register never reached its handler: ${reg.stderr.slice(0, 300)}`);
    assert.equal(json(reg.stdout).ok, true);

    const st = await run(["auth", "webauthn", "status"]);
    assert.equal(json(st.stdout).registered, 1, "status still reports no credential");
  });

  test("assert-options then assert completes with a real signature, from stdin", async () => {
    const opts = await run(["auth", "webauthn", "assert-options"]);
    assert.equal(opts.code, 0, opts.stderr.slice(0, 300));
    const pk = json(opts.stdout).publicKey;
    assert.deepEqual(
      pk.allowCredentials.map((c) => c.id),
      [CRED],
      "assert-options did not offer the credential register just stored"
    );

    const ad = authData(pk.rpId, 9);
    const cdj = Buffer.from(
      JSON.stringify({ type: "webauthn.get", challenge: pk.challenge, origin: "https://localhost" })
    );
    const sig = crypto.sign(
      "sha256",
      Buffer.concat([ad, crypto.createHash("sha256").update(cdj).digest()]),
      { key: privateKey, dsaEncoding: "der" }
    );

    // Through stdin: `-` is the path the snippet tells operators to pipe into.
    const r = await run(
      ["auth", "webauthn", "assert", "-"],
      JSON.stringify({
        id: CRED,
        authenticatorData: b64url(ad),
        clientDataJSON: b64url(cdj),
        signature: b64url(sig),
      })
    );
    assert.equal(r.code, 0, `assert failed: ${r.stdout.slice(0, 300)} ${r.stderr.slice(0, 200)}`);
    const out = json(r.stdout);
    assert.equal(out.ok, true);
    assert.equal(out.counter, 9, "counter did not come from the signed authenticatorData");
  });

  test("a tampered signature exits nonzero", async () => {
    const opts = await run(["auth", "webauthn", "assert-options"]);
    const pk = json(opts.stdout).publicKey;
    const ad = authData(pk.rpId, 11);
    const cdj = Buffer.from(
      JSON.stringify({ type: "webauthn.get", challenge: pk.challenge, origin: "https://localhost" })
    );
    const sig = crypto.sign(
      "sha256",
      Buffer.concat([authData(pk.rpId, 999), crypto.createHash("sha256").update(cdj).digest()]),
      { key: privateKey, dsaEncoding: "der" }
    );
    const r = await run(
      ["auth", "webauthn", "assert", "-"],
      JSON.stringify({
        id: CRED,
        authenticatorData: b64url(ad),
        clientDataJSON: b64url(cdj),
        signature: b64url(sig),
      })
    );
    assert.equal(r.code, 1, "a bad signature exited 0 — the shell cannot tell it failed");
    assert.match(r.stdout, /SIGNATURE_INVALID/);
  });

  test("an unreadable payload fails without touching the store", async () => {
    const r = await run(["auth", "webauthn", "register", path.join(home, "nope.json")]);
    assert.equal(r.code, 1);
    assert.match(r.stderr, /cannot read payload/);
    const st = await run(["auth", "webauthn", "status"]);
    assert.equal(json(st.stdout).registered, 1, "a failed read changed the credential store");
  });

  test("every xclaw command the snippet names is an implemented action", async () => {
    // A remedy or instruction string is a claim about the product. This snippet
    // used to fetch two /xclaw/webauthn/* routes that exist in no route table.
    const named = [...webauthnBrowserSnippet().matchAll(/xclaw auth webauthn ([a-z-]+)/g)].map(
      (m) => m[1]
    );
    assert.ok(named.length >= 2, `snippet named no commands — the scanner stopped matching`);
    const usage = await run(["auth", "webauthn", "no-such-action"]);
    for (const action of new Set(named)) {
      assert.ok(
        usage.stderr.includes(action),
        `snippet tells the operator to run "xclaw auth webauthn ${action}", which the usage line does not offer`
      );
    }
    assert.ok(
      !/fetch\('\/xclaw\//.test(webauthnBrowserSnippet()),
      "snippet fetches a gateway route; none of the /xclaw/webauthn/* routes exist"
    );
  });
});
