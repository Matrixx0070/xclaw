# XClaw Live Voice — 1 year ahead

Reference stacks studied: **OpenJarvis** (Stanford / open-jarvis), PersonalJarvis, local-jarvis, Hermes+HUD voice.

Goal: **live voice** that is not “STT → full agent → TTS” only, but a **duplex session** with barge-in, tool routing, and XClaw’s existing swarm/computer stack.

---

## 1. What OpenJarvis teaches

| Primitive | OpenJarvis | XClaw takeaway |
|-----------|------------|----------------|
| **Local-first engines** | Ollama / vLLM / llama.cpp + cloud optional | Keep Grok/xAI primary; add local STT/TTS always-on |
| **Agents** | On-demand / scheduled / continuous | Map continuous → heartbeat + voice session |
| **Morning digest + TTS** | Spoken briefing | `xclaw voice brief` over same tools |
| **Voice/Live (browser)** | PCM in → transcription → gated dispatch → agent → TTS PCM out, **barge-in epochs** | Copy **epoch cancellation + playback credits** pattern |
| **Energy/latency as metrics** | First-class eval | Track voice turn latency in doctor / SLO |

OpenJarvis is a **local personal AI framework**. XClaw is a **gateway + computer-use + swarm** agent. Voice should sit **on the gateway**, not replace the agent loop.

---

## 2. Target architecture (1 year ahead)

```text
                    ┌─────────────┐
  Mic / phone  ───► │ Voice Edge  │  wake · VAD · optional local STT
                    │  (device)   │
                    └──────┬──────┘
                           │ WebSocket / WebRTC (PCM or Opus)
                    ┌──────▼──────┐
                    │ XClaw Voice │  session · epochs · barge-in
                    │  Gateway    │  duplex policy
                    └──────┬──────┘
           ┌───────────────┼───────────────┐
           ▼               ▼               ▼
     Realtime LLM     Full agent      Casual TTS-only
     (low latency)    (tools/swarm)   (small talk)
           │               │
           └───────┬───────┘
                   ▼
            TTS stream → speaker
```

### Modes

| Mode | Latency target | Uses tools? |
|------|----------------|-------------|
| **Casual** | &lt;800 ms to first audio | No |
| **Agent** | 1–5 s acceptable | Yes (bash, browser, swarm) |
| **Realtime S2S** | &lt;500 ms | Limited tools / deferred tools |

### Non-negotiables

1. **Barge-in** — user speech cancels current TTS epoch  
2. **Commit boundaries** — only “final” phrases go to agent  
3. **Tool isolation** — long tools don’t block the voice socket (async job + spoken progress)  
4. **Privacy knobs** — local STT option; no audio retention by default  
5. **XClaw signature** — voice-driven commits still get Co-Authored-By trailers  

---

## 3. Build phases

### V0 — Pipe (now)
- STT (Whisper API or local faster-whisper) → existing agent text path → TTS (OpenAI/ElevenLabs/edge)
- CLI: `xclaw voice once` push-to-talk

### V1 — Session
- WebSocket voice session on gateway
- Partial transcripts, final commit, simple barge-in
- Channel: “voice” alongside telegram/discord

### V2 — Duplex + router
- Fast classifier: casual vs agent vs swarm  
- Streaming TTS with sentence flush  
- Epoch IDs for cancel  

### V3 — 1 year ahead
- Optional **speech-to-speech** realtime model for casual  
- On-device wake word  
- Multi-device (phone + desktop) same session  
- Voice-driven swarm with spoken join summary  
- Eval harness: turn latency, barge-in success, WER, tool success under noise  

---

## 4. Install OpenJarvis (reference, host machine)

**Not required to run XClaw** — study / compare only.

```bash
# Linux / macOS / WSL2
curl -fsSL https://open-jarvis.github.io/OpenJarvis/install.sh | bash

jarvis
jarvis doctor
jarvis init --preset chat-simple
# Voice-ish: morning digest TTS
# jarvis init --preset morning-digest-linux
```

Manual clone:

```bash
git clone https://github.com/open-jarvis/OpenJarvis.git
cd OpenJarvis
uv sync
# optional desktop / speech extras:
# uv sync --extra desktop
```

Docs: https://open-jarvis.github.io/OpenJarvis/

---

## 5. XClaw voice module sketch

```text
src/voice/
  session.mjs       — session state, epochs
  stt.mjs           — providers
  tts.mjs           — providers + stream
  router.mjs        — casual vs agent
  gateway-ws.mjs    — /voice/ws
  policy.mjs        — retention, consent
```

Config sketch:

```json
{
  "voice": {
    "enabled": true,
    "stt": { "provider": "openai-whisper" },
    "tts": { "provider": "openai", "voice": "alloy" },
    "realtime": { "enabled": false },
    "bargeIn": true,
    "retention": "none"
  }
}
```

---

## 6. What we will not copy blindly

- Full OpenJarvis local-engine stack (XClaw stays Node gateway + xAI/OpenAI)  
- Replacing swarm/computer with OpenJarvis agents  
- Token/onchain “swarm rewards” from other Jarvis forks  

We **will** copy: session epochs, barge-in, TTS streaming, spoken digests, latency metrics.

---

## 7. Immediate next engineering step

**V0 implementation in XClaw:** `src/voice/` + `xclaw voice once` using existing API keys, then wire a gateway WebSocket for V1.
