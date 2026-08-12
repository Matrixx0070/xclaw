# Voice on THIS Grok seat (already available)

You do **not** need Ollama, Piper, or paid OpenAI Realtime for TTS on this environment.

## Already on the seat

### TTS — connected **Voice** service
Tools:
- `voice_generate_speech` → MP3 from text  
- `voice_list_voices` → voice catalog  
- `voice_generate_multi_speech` → multi-speaker  

**Voices (examples):** ara, eve, luna, leo, orion, rex, sirius, atlas, helios, cosmo, celeste, …

### LLM / agent
Reasoning runs on the **Grok computer / XClaw agent loop** for this session — not a separate downloadable weight tree required for basic voice PA behavior.

### Optional later on a user machine
Ollama / whisper / piper remain supported via `providers/local.mjs` when XClaw is installed on a bare host **without** the Grok Voice connector.

## XClaw wiring

```text
Personal Assistant
  speak  → seat Voice (voice_generate_speech)
  think  → XClaw agent / configured model on host
  tools  → xclaw_bash, files, browser, swarm (full system)
```

Default voice id: **`ara`**

## Probe

In a Grok computer session: list voices via Voice connector; generate a test MP3 with `voice_generate_speech`.
