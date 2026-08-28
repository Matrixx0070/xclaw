/**
 * §7.1 sibling of the v3.335.0 assertion fix: a registration response's
 * clientData carries the ceremony context too, and completeRegistration
 * checked only the challenge. Unchecked, an assertion response ("webauthn.get")
 * replays as a registration, and a credential minted on a phishing origin —
 * which the victim's browser stamps into clientData.origin — registers here
 * and then gates everything from then on. Both measured ACCEPTED before the
 * fix.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import {
  createRegistrationOptions,
  completeRegistration,
} from "../src/auth/webauthn.mjs";

const b64url = (buf) => Buffer.from(buf).toString("base64url");

async function attempt(mutateCd) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "xclaw-wa-reg-"));
  const cfg = { paths: { configDir: dir }, auth: { webauthn: { rpId: "localhost", origin: "https://localhost" } } };
  const reg = await createRegistrationOptions(cfg);
  const cd = mutateCd({
    type: "webauthn.create",
    challenge: reg.publicKey.challenge,
    origin: "https://localhost",
  });
  return completeRegistration(cfg, {
    id: "cred-reg-ctx",
    clientDataJSON: b64url(Buffer.from(JSON.stringify(cd))),
  });
}

describe("registration context is verified", () => {
  it("a well-formed registration still passes", async () => {
    const out = await attempt((cd) => cd);
    assert.equal(out.ok, true, out.error);
  });

  it("refuses an assertion-type clientData replayed as a registration", async () => {
    const out = await attempt((cd) => ({ ...cd, type: "webauthn.get" }));
    assert.equal(out.ok, false, "a webauthn.get response registered a credential");
    assert.match(out.error || "", /type/i);
  });

  it("refuses a registration minted on another origin", async () => {
    const out = await attempt((cd) => ({ ...cd, origin: "https://evil.example" }));
    assert.equal(out.ok, false, "a phishing origin's registration was accepted");
    assert.match(out.error || "", /origin/i);
  });
});
