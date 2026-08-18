import { describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";

/**
 * Regressions from live verification of the 3.77–3.80 voice stack:
 * every one of these shipped as documented-but-absent, and the binary path
 * crashed the whole gateway process.
 */
describe("voice-ws protocol completeness", () => {
  it("every documented client message type has a handler", async () => {
    const src = await fs.readFile(
      new URL("../src/gateway/voice-ws.mjs", import.meta.url),
      "utf8"
    );
    const documented = [
      "ping",
      "utterance",
      "wake",
      "command",
      "barge_in",
      "pcm_start",
      "pcm_end",
      "opus_start",
      "opus_end",
      "webrtc_offer",
      "webrtc_ice",
      "webrtc_close",
    ];
    for (const type of documented) {
      assert.ok(
        src.includes(`type === "${type}"`),
        `documented message "${type}" has no handler — it would answer unknown_type`
      );
    }
  });

  it("binary audio handlers are defined, not just called", async () => {
    const mod = await fs.readFile(
      new URL("../src/gateway/voice-ws.mjs", import.meta.url),
      "utf8"
    );
    // Calling an undefined function threw a ReferenceError that killed the
    // gateway process on the first binary frame from any client.
    assert.match(mod, /function handlePcmBinary\(/);
    assert.match(mod, /function handleOpusBinary\(/);
  });

  it("client messages cannot reject into an unhandled rejection", async () => {
    const src = await fs.readFile(
      new URL("../src/gateway/voice-ws.mjs", import.meta.url),
      "utf8"
    );
    assert.ok(
      !/void handleClientMessage\(/.test(src),
      "handleClientMessage must not be fire-and-forget — a rejection kills the process"
    );
    assert.match(src, /handleClientMessage\([^)]*\)\s*\.catch\(/);
  });

  it("close frames complete the handshake", async () => {
    const src = await fs.readFile(
      new URL("../src/gateway/voice-ws.mjs", import.meta.url),
      "utf8"
    );
    assert.match(src, /msg\.type === "close"/);
    assert.match(src, /sendClose\(/);
  });
});

describe("voice edge clients carry gateway auth", () => {
  it("resolveVoiceWsUrl appends the token", async () => {
    const { resolveVoiceWsUrl } = await import("../src/voice/ws-url.mjs");
    const url = resolveVoiceWsUrl({ url: "http://127.0.0.1:1234", token: "s3cret" });
    assert.equal(url, "ws://127.0.0.1:1234/ws/voice?token=s3cret");
  });

  it("https maps to wss and an existing token is not duplicated", async () => {
    const { resolveVoiceWsUrl } = await import("../src/voice/ws-url.mjs");
    assert.match(resolveVoiceWsUrl({ url: "https://h/", token: "t" }), /^wss:\/\/h\/ws\/voice\?token=t$/);
    const once = resolveVoiceWsUrl({ url: "ws://h/ws/voice?token=a", token: "b" });
    assert.equal((once.match(/token=/g) || []).length, 1);
  });

  it("no token configured still yields a usable url", async () => {
    const { resolveVoiceWsUrl } = await import("../src/voice/ws-url.mjs");
    const prev = process.env.XCLAW_GATEWAY_TOKEN;
    delete process.env.XCLAW_GATEWAY_TOKEN;
    try {
      assert.equal(
        resolveVoiceWsUrl({ url: "http://127.0.0.1:1/" }),
        "ws://127.0.0.1:1/ws/voice"
      );
    } finally {
      if (prev !== undefined) process.env.XCLAW_GATEWAY_TOKEN = prev;
    }
  });
});

describe("probes report absent binaries honestly", () => {
  it("a missing binary is not reported as available", async () => {
    const { probeLocalVoiceStack } = await import("../src/voice/providers/local.mjs");
    const v = await probeLocalVoiceStack(
      { voice: { local: { whisperBin: "xclaw-definitely-not-installed" } } },
      { skipNetwork: true }
    );
    // The ENOENT message contains the binary name; a name-matching probe used
    // to accept that as proof the tool existed.
    assert.equal(v.stt.ok, false);
  });
});
