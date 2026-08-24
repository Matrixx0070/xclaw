/**
 * XClaw Personal Assistant — primary live voice agent (LOCAL models).
 *
 * Full autonomous control of the host where XClaw is installed.
 * Think/speak default to Ollama + espeak/piper — no paid APIs.
 */
import { createVoiceAgent } from "./runtime.mjs";
import { getVoiceAgentPreset } from "./presets.mjs";
import { localThink, localSpeak } from "../providers/local.mjs";

export function createPersonalAssistant(opts = {}) {
  const cfg = opts.cfg || {};
  const localOnly = cfg.voice?.localOnly !== false;

  return createVoiceAgent({
    ...opts,
    preset: "personal_assistant",
    think:
      opts.think ||
      (localOnly
        ? (prompt, ctx) => localThink(prompt, ctx, cfg)
        : undefined),
    speak:
      opts.speak ||
      (localOnly
        ? async (text) => {
            const r = await localSpeak((await import("../speakable.mjs")).toSpeakableText(text), cfg);
            if (!r.ok) return;
            try {
              const { spawn } = await import("node:child_process");
              await new Promise((resolve) => {
                const p = spawn("aplay", [r.path], { stdio: "ignore" });
                p.on("close", resolve);
                p.on("error", resolve);
              });
            } catch {
              /* no audio device — text path still works */
            }
          }
        : undefined),
  });
}

export function personalAssistantCard() {
  const p = getVoiceAgentPreset("personal_assistant");
  return {
    id: p.id,
    name: p.name,
    badge: "System control · local models",
    blurb: p.description,
    capabilities: [
      "Live conversation (speak + listen)",
      "Local LLM via Ollama (no paid API)",
      "Local TTS via espeak-ng / Piper",
      "Full host control via XClaw tools (shell, files, browser)",
      "Swarm for multi-step work",
      "Works while talking (dual-plane / entente)",
      "Barge-in mutes speech only — jobs keep running",
    ],
    tools: p.tools,
  };
}
