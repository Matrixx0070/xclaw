# JARVIS voice — build spec

Three work packages that turn today's working voice engine into a hands-free
assistant you talk to. Each is independent and shippable on its own.

Written for whoever builds next (human or agent). Read **Rules of engagement**
first — the previous voice line shipped features that were documented,
advertised in the protocol handshake, and covered by passing tests, yet did not
exist at runtime. Those failure modes are listed so they are not repeated.

---

## Rules of engagement

**Branch from the current `origin/main`.** The 3.77–3.80 line was authored
against v3.76-era file content and silently reverted the 3.113–3.130 hardening
(risk-tier approvals, `/trust` window, `riskWorkingDir` fail-closed writes,
cost-governor bands, objective auto-promotion). Reconciling it cost a full day.
Before starting: `git fetch origin && git log --oneline -1 origin/main`, and
branch from that commit.

**Version numbers only go forward.** `package.json` is currently ahead of any
number you may remember. Never renumber down; never re-tag an existing version.

**Never delete a capability to make room for a new one.** If something seems
redundant, leave it and say so in the PR.

**A passing test suite is not proof a feature works.** These all shipped green:

- `handlePcmBinary`/`handleOpusBinary` were *called but never defined* — one
  binary frame killed the entire gateway process (Telegram, webchat, jobs).
- `pcm_start`/`opus_start`/`webrtc_offer` were documented and advertised in the
  `ready` frame but had no handlers; they answered `unknown_type`.
- `acceptOffer` used werift's object-form `RTCSessionDescription`, which throws.
  The accompanying test only checked that the module imported.
- The STT probe reported `ok` with nothing installed, because the ENOENT text
  `"spawn whisper-cli ENOENT"` matched a `/whisper/i` name check.

So: **prove each acceptance criterion against the running gateway**, with the
command and its real output pasted into the PR. Every criterion below is written
as something you run, not something you assert.

**Client input must never be able to crash the gateway.** Faults belong to the
connection. `handleClientMessage` is invoked with a `.catch()` for this reason —
keep it.

**Probes must fail closed.** If a binary, model, or device is missing, report it
missing. Never let an error message that happens to contain the tool's name
count as the tool being present.

---

## Facts you need (verified, not assumed)

Live host: no soundcard (`arecord -l` → "no soundcards found"), so the
microphone is always a client device (phone/laptop browser), never the server.

Config is read **flat** from `cfg.voice.*` by `localConfig()` in
`src/voice/providers/local.mjs`. A nested `cfg.voice.local.*` is silently
ignored — this cost a debugging round already. Current live values:

```json
"voice": {
  "whisperBin": "/usr/local/bin/whisper-cli",
  "whisperModel": "/opt/whisper.cpp/models/ggml-base.en.bin"
}
```

`/ws/voice` protocol as it exists today (`src/gateway/voice-ws.mjs`):

| Direction | Message | Notes |
|---|---|---|
| → | `{type:"utterance"\|"command", text, speak}` | runs a conversation turn |
| → | `{type:"pcm_start"\|"pcm_end"}` + binary frames | s16le mono, 16 kHz |
| → | `{type:"opus_start"\|"opus_end"}` + binary frames | packets or ogg |
| → | `{type:"webrtc_offer"\|"webrtc_ice"\|"webrtc_close"}` | werift signaling |
| → | `{type:"barge_in"}` | stops speech immediately |
| ← | `{type:"ready", sessionId, conversationId, workingDir, pcm, opus}` | handshake |
| ← | `{type:"transcript", text}` | after audio finalize |
| ← | `{type:"event", event:"tool", phase, name}` | streams mid-turn |
| ← | `{type:"reply", text, tts, opus}` | end of turn |

Auth: the gateway rejects unauthenticated upgrades. Browsers cannot set
WebSocket headers, so the token rides as `?token=` — build URLs with
`resolveVoiceWsUrl()` from `src/voice/ws-url.mjs`, never by hand.

Conversation: a voice session is a real conversation. `runVoiceTurn()` calls the
channel-invariant `runAgent()` with `chatSessionId: state.conversationId` and a
persistent `workingDir`, so turns remember each other and share files. Pass
`?conversation=<id>` to resume a thread across reconnects. **Do not** reintroduce
per-utterance `runJob()` — that was the bug that made voice tool-capable but
memory-less.

Speech plane: `entente.speech` owns speaking state — `isSuppressed()`,
`beginSpeak()`, `endSpeak()`, `bargeIn()`. Playback is
`playWavInterruptible()` in `src/voice/playback.mjs`; its child process must
**not** be `unref()`d (an unref'd child lets the event loop drain mid-playback).

Existing pieces you should reuse rather than rewrite: `src/voice/vad.mjs`
(hysteresis endpointing + `pcmToWav`), `src/voice/sentence-tts.mjs`
(sentence-flush streaming TTS), `src/voice/wake/index.mjs` (`matchWakePhrase`,
`wavRmsEnergy`), `src/voice/metrics.mjs` (TTFA / barge-in metrics).

---

## WP1 — Natural voice (piper)

**Why**: TTS is currently espeak-ng, which sounds like a 1980s speech box. It is
so synthetic that whisper mis-transcribes it ("brown fox" → "round fox"). This
is the smallest change with the largest effect on how the assistant feels.

**Already supported — do not rewrite it.** `localSpeak()` in
`src/voice/providers/local.mjs` already prefers piper whenever `piperModel` is
set, and falls back to espeak. The work is installation, configuration, and
honest reporting.

### Build

1. Install the piper binary (rhasspy/piper release, `piper_linux_x86_64.tar.gz`)
   to `/opt/piper`, symlink `/usr/local/bin/piper`.
2. Download one voice to `/opt/piper/voices/` — both the `.onnx` and its
   `.onnx.json` are required. Suggested: `en_GB-alan-medium` (British male, fits
   the assistant register) or `en_US-amy-medium`. ~63 MB per voice.
3. Set live config **flat** (`~/.xclaw/xclaw.json`):
   ```json
   "voice": { "piperBin": "/usr/local/bin/piper",
              "piperModel": "/opt/piper/voices/en_GB-alan-medium.onnx" }
   ```
4. Extend `probeLocalVoiceStack()` so `tts` reports which engine is actually in
   use (`piper` vs `espeak-ng`) and, when piper is configured, verifies the model
   file exists. A configured-but-missing model must report **not ok** — it must
   not silently fall back while claiming piper.
5. Doctor: surface the active TTS engine in `voice.local`.

### Acceptance (run these)

```bash
xclaw voice probe            # expect tts.provider === "piper"

node --input-type=module -e '
const { loadConfig } = await import("./src/config/load.mjs");
const { localSpeak } = await import("./src/voice/providers/local.mjs");
console.log(await localSpeak("Systems are online.", await loadConfig()));'
```
Today that second command prints
`{"ok":true,"path":"/tmp/xclaw-tts-….wav","provider":"espeak-ng"}` — the
package is done when `provider` reads `piper` and the WAV plays as natural
speech.
- Round trip: speak a sentence with piper, transcribe it with
  `localTranscribe()` — the transcript should match materially better than the
  espeak baseline ("The quick brown fox…" currently returns "The quick **round**
  fox…").
- Point `piperModel` at a non-existent path → probe reports **not ok**, and does
  not claim piper while quietly using espeak.
- `xclaw doctor` shows the engine in `voice.local`.

**Non-goals**: streaming piper synthesis, voice cloning, multiple voices.

---

## WP2 — Continuous hands-free mode (Web UI)

**Why**: today the Web UI is three manual actions — click mic, click send, click
🔊. That is dictation, not conversation. This package makes it zero.

**Current state**: `ui/webchat/app.js` records with `MediaRecorder`, POSTs to
`/api/voice/transcribe` (which accepts `audioBase64`), and puts the transcript in
the input box. Server-side STT is local whisper; browser SpeechRecognition
remains a fallback. `#btn-mic.recording` pulses while recording.

### Build

Add a **conversation mode** toggle (a distinct control from the existing
press-to-talk mic — keep press-to-talk working).

When conversation mode is on:

1. Hold the mic stream open and run browser-side VAD (Web Audio
   `AnalyserNode` RMS with hysteresis — mirror the thresholds in
   `src/voice/vad.mjs`: open 500, close 325, ~450 ms silence to endpoint).
2. On endpoint: send that audio segment to `/api/voice/transcribe`, then
   **auto-send** the transcript as a chat message. No click.
3. When the reply arrives, **auto-speak** it (`/api/voice/speak`, or stream
   over `/ws/voice`). No click.
4. **Barge-in**: if speech energy is detected while the assistant is speaking,
   stop playback immediately and start capturing. This is the difference between
   a demo and something usable.
5. Show state plainly — *listening / thinking / speaking* — and make it obvious
   when the mic is hot. Never record with no visible indicator.
6. Persist the toggle (localStorage) but default it **off**; an always-on
   microphone must be an explicit choice.

### Acceptance (run these)

- Enable conversation mode, say *"run hostname and tell me the value"*, say
  nothing else: the reply is spoken aloud with **zero clicks**.
- Immediately follow with *"what did you just say?"* — it answers from memory
  (voice turns already share a conversation).
- Talk over the assistant mid-reply: playback stops within ~300 ms and your new
  speech is captured (`voice metrics` records a barge-in).
- Toggle off → behaviour returns exactly to today's press-to-talk. Reload the
  page → mode is off unless explicitly enabled.
- Deny microphone permission → a clear message, no console errors, no silent
  dead UI.

**Non-goals**: wake word (WP3), speaker identification, multi-user rooms.

---

## WP3 — Wake word in the browser

**Why**: with WP2 you still click once to open the session. This removes the
last click: say *"hey xclaw"* from across the room.

**Current state**: wake matching already exists server-side —
`matchWakePhrase()` and `wavRmsEnergy()` in `src/voice/wake/index.mjs`, phrases
`hey xclaw | okay xclaw | hi xclaw | xclaw`. The server-side listen loop
(`xclaw voice listen`) implements the full cycle but needs a microphone, which
this host does not have.

### Build

1. Browser-side energy gate: cheap RMS check so audio is only transcribed when
   someone is actually speaking. Never stream continuous audio to the server.
2. On energy: capture a short window (~2 s), transcribe, and test it with the
   **same** phrase list — expose the phrases from the server (extend
   `/api/voice/probe`) instead of duplicating them in the client. One source of
   truth.
3. On a wake hit: acknowledge audibly or visually, then hand off to WP2's
   capture-and-send cycle.
4. Idle cost must be near zero: no network traffic while nobody is talking. State
   this in the PR with a measurement.
5. Privacy: wake detection runs locally in the browser; audio leaves the page
   only after a wake hit. Say so in the UI.

### Acceptance (run these)

- Say *"hey xclaw, what is the hostname"* with no interaction at all: it wakes,
  answers, and speaks.
- Ambient conversation without the phrase for 60 s: no transcription requests
  (check the network panel), no false wakes.
- `xclaw voice metrics` shows `wakeHits` incrementing.
- Wake phrases come from the server probe — changing them in config changes
  browser behaviour with no client edit.

**Non-goals**: custom wake-word training, openWakeWord models, offline
neural wake detection.

---

## Definition of done (all packages)

- Every acceptance command above run against the **live gateway**, with real
  output in the PR.
- `node --test test/**/*.test.mjs` green, plus new tests for new behaviour.
- `xclaw doctor` has no new errors, and any new check reports honestly on a host
  that lacks the dependency.
- Nothing in `src/security/`, `src/tokens/cost-governor.mjs`, or the approval
  path changed as a side effect.
- `CHANGELOG.md` entry describing behaviour, not file names.
