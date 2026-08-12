# XClaw Live Voice Agent — Personal Assistant

Product target: same class as **Voice Agents (Beta)** templates
(Customer Support, Sales, Scheduler, **Personal Assistant**, Lead Qualification)
— but the **Personal Assistant** is the one that matters for XClaw:

> **Live voice conversation + fully autonomous control of the machine where XClaw is installed.**

---

## What you asked for

| Need | XClaw answer |
|------|----------------|
| Speaks like screenshot-type agents | Presets: Personal Assistant, Support, Sales, … |
| During conversation, fully autonomous | `autonomy: full` + tool loop mid-call |
| Controls full system where installed | bash, files, browser, swarm on **host** |
| Don’t stop mind while talking | Entente dual-plane (speech ≠ jobs) |

---

## Architecture

```text
User mic ──► STT / realtime audio
                │
                ▼
        Voice Agent (Personal Assistant)
        instructions + tool policy
                │
        ┌───────┴────────┐
        ▼                ▼
   Speech plane      Cognitive plane
   (TTS, barge-in)   (tools, swarm, computer)
        │                │
        └──── entente ───┘
```

Industry parallel (2026): realtime voice models that **talk while tool calls run** and systems that **control the computer from voice**. XClaw does this with **host tools**, not only cloud SaaS actions.

---

## Preset: Personal Assistant

- **System control:** yes  
- **Tools:** `xclaw_bash`, `xclaw_file_read`, `xclaw_file_write`, `xclaw_browser_tab`, `xclaw_swarm_run`  
- **Speak while tools:** yes  
- **Barge-in:** mute mouth only  

Safe-by-default: ask before irreversible destroy / public post / financial send.

---

## CLI (planned / wiring)

```bash
xclaw voice agents                    # list presets
xclaw voice agent personal_assistant  # start session
xclaw voice once --preset personal_assistant
```

---

## Code

| Path | Role |
|------|------|
| `src/voice/agents/presets.mjs` | Template catalog |
| `src/voice/agents/runtime.mjs` | Live agent + tools + speakWhileTools |
| `src/voice/agents/personal-assistant.mjs` | Primary entry |
| `src/voice/entente.mjs` | Mouth ‖ mind policy |

---

## Success criteria

1. User can talk continuously to XClaw on the install host.  
2. Agent runs real tools **during** the conversation.  
3. Interrupting speech does **not** kill shell/browser/swarm jobs.  
4. “Cancel that” stops jobs; “stop talking” only stops TTS.  
