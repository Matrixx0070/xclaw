/**
 * The /channel/ surface is gated the same way regardless of gateway.authStrict,
 * and the one self-authenticating path under it stays open.
 *
 * There used to be two auth lists: a "legacy" subset for authStrict:false and a
 * strict superset. They drifted — /channel/ ended up in the strict list only —
 * so on an authStrict:false gateway POST /channel/webchat/message, which RUNS
 * THE AGENT, answered without credentials (measured on a real socket: 200 anon,
 * byte-identical to the authenticated response). 3.193.0 collapsed the two lists
 * into one. These pins hold the collapse: the three authStrict settings must be
 * indistinguishable to the gate.
 *
 * The exception is /channel/telegram/webhook, which Telegram calls with its
 * secret header and never a Bearer; the handler verifies that secret and fails
 * closed. It must stay open to the operator gate in every mode or the bot goes
 * silent. Unlike the webchat UI page (a separate route table that could disagree
 * with the auth list, hence its live test), this exemption IS the gate, so a
 * unit test settles it.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { createGatewayAuth } from "../src/gateway/auth.mjs";

const TOKEN = "c".repeat(48);

/** authStrict flavours, all with a token configured (the shipped shape). */
const MODES = [
  ["authStrict:false (legacy — the leak)", { token: TOKEN, authStrict: false }],
  ["authStrict:true (strict)", { token: TOKEN, authStrict: true }],
  ["authStrict unset (default)", { token: TOKEN }],
];

/** Every /channel/ path that runs the agent or exposes a conversation. */
const AGENT_PATHS = [
  "/channel/webchat/message",
  "/channel/webchat/message/stream",
  "/channel/webchat/sessions",
  "/channel/webchat/history",
];

describe("/channel/ agent execution is gated in every authStrict mode", () => {
  for (const [label, gateway] of MODES) {
    const auth = createGatewayAuth({ gateway });
    for (const p of AGENT_PATHS) {
      it(`${label}: protects ${p}`, () => {
        assert.equal(auth.isProtectedPath(p), true, `${p} open under ${label}`);
      });
    }
    it(`${label}: leaves /channel/telegram/webhook open (self-verifying)`, () => {
      assert.equal(auth.isProtectedPath("/channel/telegram/webhook"), false);
    });
  }

  it("authStrict cannot change any /channel/ decision (the collapse invariant)", () => {
    const strict = createGatewayAuth({ gateway: { token: TOKEN, authStrict: true } });
    const legacy = createGatewayAuth({ gateway: { token: TOKEN, authStrict: false } });
    for (const p of [...AGENT_PATHS, "/channel/telegram/webhook", "/channels", "/channels/telegram"]) {
      assert.equal(
        strict.isProtectedPath(p),
        legacy.isProtectedPath(p),
        `${p} decided differently by authStrict — the two lists have drifted again`
      );
    }
  });

  it("channel MANAGEMENT (/channels — writes bot secrets) is always protected", () => {
    // Distinct from /channel/ traffic: /channels writes channel config including
    // bot tokens, so it is in `core`-adjacent territory and must never be open.
    for (const [label, gateway] of MODES) {
      const auth = createGatewayAuth({ gateway });
      assert.equal(auth.isProtectedPath("/channels"), true, `/channels open under ${label}`);
      assert.equal(auth.isProtectedPath("/channels/telegram"), true, `/channels/telegram open under ${label}`);
    }
  });
});
