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
    // Canonical location is cfg.voice.* — localConfig() reads it flat, and a
    // nested cfg.voice.local.* override is silently ignored.
    const v = await probeLocalVoiceStack(
      { voice: { whisperBin: "xclaw-definitely-not-installed" } },
      { skipNetwork: true }
    );
    // The ENOENT message contains the binary name; a name-matching probe used
    // to accept that as proof the tool existed.
    assert.equal(v.stt.ok, false);
  });
});

describe("voice config has one source of truth", () => {
  it("wake probe and transcription resolve the same whisper binary", async () => {
    const { probeWakeStack } = await import("../src/voice/wake/index.mjs");
    const { localConfig } = await import("../src/voice/providers/local.mjs");
    const cfg = { voice: { whisperBin: "xclaw-probe-marker-bin" } };
    const w = await probeWakeStack(cfg);
    assert.equal(localConfig(cfg).whisperBin, "xclaw-probe-marker-bin");
    // The wake probe must report the same binary transcription would run,
    // not a separately-parsed config path.
    assert.equal(w.stt.ok, false);
  });
});

describe("wake readiness reflects hardware, not just tooling", () => {
  it("an installed arecord with no capture device is not ready", async () => {
    // `arecord --version` succeeds on any host with alsa-utils; `arecord -l`
    // exits 0 while printing "no soundcards found". Wake capture needs a real
    // device, so the probe must inspect the device listing and fail closed.
    // The listing check now lives in the multi-backend capture probe rather
    // than inline in wake/index.mjs, so assert the behaviour, not the file.
    const probeSrc = await fs.readFile(
      new URL("../src/voice/capture-probe.mjs", import.meta.url),
      "utf8"
    );
    assert.match(probeSrc, /arecord", \["-l"\]/);
    const { parseArecordList } = await import("../src/voice/capture-parsers.mjs");
    assert.deepEqual(parseArecordList("no soundcards found..."), []);
    const real =
      "card 1: PCH [HDA Intel PCH], device 0: ALC257 Analog [ALC257 Analog]";
    const cards = parseArecordList(real);
    assert.equal(cards.length, 1);
    assert.equal(cards[0].card, 1);
  });
});

describe("a voice session is a conversation, not a series of jobs", () => {
  it("voice turns run the channel-invariant agent with a conversation id", async () => {
    const src = await fs.readFile(
      new URL("../src/gateway/voice-ws.mjs", import.meta.url),
      "utf8"
    );
    // Each utterance used to spawn runJob(): no history, and an empty
    // /tmp/xclaw-jobs workspace, so follow-ups and file access could not work.
    assert.ok(
      !/runJob\(\{\s*\n?\s*goal: text/.test(src),
      "voice turns must not spawn a fresh job per utterance"
    );
    assert.match(src, /runAgent\(\{/);
    assert.match(src, /chatSessionId: state\.conversationId/);
    assert.match(src, /workingDir: state\.workingDir/);
  });

  it("a conversation id is stable per session and resumable via query param", async () => {
    const src = await fs.readFile(
      new URL("../src/gateway/voice-ws.mjs", import.meta.url),
      "utf8"
    );
    assert.match(src, /searchParams\.get\("conversation"\)/);
    assert.match(src, /`voice_\$\{sessionId\}`/);
    // The handshake tells the client what thread and workspace it is in.
    assert.match(src, /type: "ready"[\s\S]{0,200}conversationId/);
  });

  it("tool activity is surfaced to the client mid-turn", async () => {
    // The frame is built in voice-events.mjs now: the hand-written filter that
    // used to sit in the socket forwarded tool start/end and NOTHING else, so
    // an approval ask reached the caller through no surface at all. The socket
    // delegates; the vocabulary lives in the pure module beside it.
    const src = await fs.readFile(new URL("../src/gateway/voice-ws.mjs", import.meta.url), "utf8");
    assert.match(src, /voiceClientEvent\(e, \{ sessionId \}\)/);
    const events = await fs.readFile(new URL("../src/gateway/voice-events.mjs", import.meta.url), "utf8");
    assert.match(events, /event: "tool"/);
  });
});

describe("webchat mic can use local STT", () => {
  it("transcribe endpoint accepts uploaded audio, not just server paths", async () => {
    // W2 route extraction moved the voice routes out of gateway/index.mjs.
    const src = await fs.readFile(
      new URL("../src/gateway/routes/voice.mjs", import.meta.url),
      "utf8"
    );
    // A browser has bytes, not a path — path-only meant the mic had to fall
    // back to a cloud speech API.
    assert.match(src, /audioBase64/);
    assert.match(src, /path or audioBase64 required/);
  });

  it("the mic records to the server when local STT is ready", async () => {
    const app = await fs.readFile(
      new URL("../ui/webchat/app.js", import.meta.url),
      "utf8"
    );
    assert.match(app, /MediaRecorder/);
    assert.match(app, /\/api\/voice\/transcribe/);
    assert.match(app, /serverSttReady/);
    // Browser speech stays as a fallback, not the primary path.
    assert.match(app, /webkitSpeechRecognition/);
  });
});
