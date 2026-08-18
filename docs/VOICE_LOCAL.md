# XClaw Voice — local models only (no paid APIs)

Default policy: **local-first**. Paid cloud STT/TTS/LLM are optional overrides, not required.

## Stack

| Role | Local default | Install |
|------|---------------|---------|
| **LLM** | [Ollama](https://ollama.com) | `ollama serve` + `ollama pull qwen2.5:7b` |
| **TTS** | espeak-ng or [Piper](https://github.com/rhasspy/piper) | `apt install espeak-ng` or piper + `.onnx` voice |
| **STT** | whisper.cpp / faster-whisper CLI | optional until mic pipeline |

## Quick setup

```bash
# LLM
curl -fsSL https://ollama.com/install.sh | sh
ollama pull qwen2.5:7b
ollama serve   # if not already a service

# TTS (Linux)
sudo apt install -y espeak-ng
# optional better voice:
# download a Piper en_US model and set XCLAW_PIPER_MODEL=/path/to/model.onnx

# Optional STT
# build whisper.cpp and put whisper-cli on PATH
```

## Env

```bash
export XCLAW_OLLAMA_URL=http://127.0.0.1:11434
export XCLAW_OLLAMA_MODEL=qwen2.5:7b
export XCLAW_PIPER_MODEL=/models/en_US-lessac-medium.onnx   # optional
```

## Config (`xclaw.json`)

```json
{
  "voice": {
    "enabled": true,
    "defaultPreset": "personal_assistant",
    "localOnly": true,
    "ollamaUrl": "http://127.0.0.1:11434",
    "ollamaModel": "qwen2.5:7b",
    "speakWhileTools": true,
    "bargeInMutesSpeechOnly": true
  }
}
```

## Code

- `src/voice/providers/local.mjs` — `localThink`, `localSpeak`, `localTranscribe`, `probeLocalVoiceStack`
- Personal Assistant uses these when `voice.localOnly` is true (default)

## Probe

```js
import { probeLocalVoiceStack } from "./src/voice/providers/local.mjs";
console.log(await probeLocalVoiceStack());
```


## Surfaces (talk with XClaw)

| Surface | How |
|---------|-----|
| **CLI / TUI** | `xclaw voice probe` · `xclaw voice speak "hi"` · `xclaw voice transcribe file.ogg` · `xclaw voice tui` |
| **WebUI** | Gateway `GET /api/voice/probe` · `POST /api/voice/speak` `{text}` · `POST /api/voice/transcribe` `{path}` |
| **Telegram** | Voice notes → local STT transcript injected into agent text; replies with `voiceOut.enabled` → TTS ogg |

### Telegram config

```json
{
  "channels": {
    "telegram": {
      "voiceOut": { "enabled": true, "mode": "on_request", "maxChars": 400 }
    }
  },
  "voice": { "localOnly": true }
}
```

`mode: "always"` speaks every reply; `"on_request"` when user sends a voice note or `/voice`.

### Dependencies

```bash
sudo apt install -y espeak-ng ffmpeg
# optional better TTS: piper + XCLAW_PIPER_MODEL=...
# optional STT: whisper.cpp → whisper-cli on PATH
# optional TUI mic: arecord (alsa-utils)
```


### WebChat UI

Open `/chat/` — **🎤** uses browser SpeechRecognition; **🔊** calls gateway `/api/voice/speak` (server-side espeak/piper).


## Voice commands

| Say / type | Effect |
|------------|--------|
| stop talking, shut up, `/mute` | Mute TTS (jobs keep running) |
| unmute, `/unmute` | Allow speech again |
| cancel that, `/cancel` | Cancel active voice-agent jobs |
| keep going, `/continue` | Status of active work |
| status, `/status` | Speech + job snapshot |
| repeat, `/repeat` | Re-speak last reply |
| help, `/commands` | List commands |

**Contract:** barge-in / mute never cancels shell, browser, or swarm jobs.


## Wake word (W0)

```bash
xclaw voice wake-probe           # arecord / STT / openWakeWord availability
xclaw voice wake-probe once      # 2s record → energy → STT → phrase match
xclaw voice wake-probe once --force-stt
```

Phrases (config `voice.wake.phrases`): default `hey xclaw`, `okay xclaw`, `hi xclaw`, `xclaw`.

W0 is **probe only**. Continuous listen loop is **W1**.


## W1 — Continuous listen

```bash
xclaw voice listen              # wake → command → agent/TTS
xclaw voice listen --no-speak   # no TTS
xclaw voice listen --no-agent   # localThink only
```

Loop: short wake window → energy + STT + phrase → “Yes?” → longer command record → STT → voice commands or agent.

Requires: `arecord`, local STT (whisper), optional `espeak-ng` for replies.


## Gateway voice session (W1+)

```text
ws://127.0.0.1:18790/ws/voice
```

Client → server JSON:

| type | body |
|------|------|
| `utterance` | `{ text, speak? }` committed STT → agent/commands |
| `command` | force command classifier |
| `wake` | notify wake (ack only) |
| `barge_in` | mute speech plane |
| `ping` | pong |

Server → `ready` · `reply` · `event` · `error`


## Barge-in

- `speech.bargeIn()` advances **epoch**, clears `playing`, runs registered **stoppers** (kills `aplay`/`ffplay`)
- Does **not** cancel agent/tool jobs (`jobContinue: true`)
- Playback: `src/voice/playback.mjs` — `playWav(path, { speech, epoch })` auto-stops on barge-in
- Gateway: `{ "type": "barge_in" }` on `/ws/voice`
- Voice commands: “stop talking”, `/mute`, “hold on”


### Barge-in latency

1. Registered **stoppers** run first (SIGKILL process group of player)
2. Speech **epoch** advances (stale TTS ignored)
3. Listeners notified (`killPathMs` on event)

Target: kill path **&lt;50ms** synchronous; audio stops without waiting for `playWav` await.


## VAD (Voice Activity Detection)

Energy RMS with **open/close hysteresis** (reduces false endpoints).

### Command window (default on)


After wake, XClaw streams mic PCM and **stops on silence** instead of a fixed 4s clip.

```json
{
  "voice": {
    "vad": {
      "enabled": true,
      "silenceMs": 450,
      "threshold": 500,
      "maxMs": 8000,
      "prerollMs": 2500
    }
  }
}
```

| Knob | Default | Meaning |
|------|---------|---------|
| `silenceMs` | 450 | Quiet time after speech → end |
| `threshold` | 500 | RMS speech gate (S16) |
| `maxMs` | 8000 | Hard cap |
| `prerollMs` | 2500 | Give up if no speech starts |

Disable: `xclaw voice listen` with config `voice.vad.enabled: false` (falls back to fixed `arecord -d`).


## Sentence-flush TTS

Long replies are split on `.?!` and spoken **one sentence at a time** so the first audio starts sooner.

- `speakSentences(text, cfg, { speech })` — batch flush
- `createSentenceStreamSpeaker` — push token deltas, flush on boundaries
- Barge-in still kills the current player via speech plane stoppers


## Streaming spoken replies

For short Q&A (not tool goals), listen uses **token stream → sentence-flush TTS**:

```text
chatStream onDelta → createSentenceStreamSpeaker → first sentence audio ASAP
```

Tool-like phrases (`run`, `write file`, `browse`, …) still use full `runJob` then sentence TTS.

Disable stream: `voice.listen.stream: false` or env-only path without API keys (localThink).


### Wake window (optional)

```json
{ "voice": { "vad": { "wake": true, "wakeSilenceMs": 350 } } }
```

Doctor: `voice.vad` shows open/close thresholds.


### VAD engine details

- **Energy RMS** per 30 ms frame (S16_LE mono @ 16 kHz)
- **Hysteresis**: `openThreshold` to enter speech, `closeThreshold` (~65%) to leave
- **Hangover**: require N consecutive open frames before locking speech
- **Auto-calibrate**: first ~300 ms median noise floor × 3.5 → open threshold
- CLI: `xclaw voice vad` · `xclaw voice vad once` (live endpoint test)


## Binary PCM on `/ws/voice`

```text
→ { "type": "pcm_start", "sampleRate": 16000, "channels": 1 }
→ (binary frames: S16_LE mono PCM chunks)
→ { "type": "pcm_end" }
← { "type": "event", "event": "transcript", "text": "..." }
← { "type": "reply", "text": "..." }
```

Max buffer ~30s. Gateway runs local STT then the same utterance/agent path as JSON text.


## Opus on `/ws/voice` (O1)

```text
→ { "type": "opus_start", "sampleRate": 16000, "container": "packets" }
→ binary Opus packets (one packet per frame)
→ { "type": "opus_end" }
```

`container: "ogg"` — binary frames are Ogg/Opus bytes (ffmpeg decode).

Decoders (first hit wins): `opusscript` → `@discordjs/opus` → `ffmpeg` (ogg).

```bash
xclaw voice opus    # probe backends
npm i opusscript    # optional packet decoder
```
