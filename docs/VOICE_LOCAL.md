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
