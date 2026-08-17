/**
 * Simple TUI voice session: text in → local LLM → TTS (play if aplay/ffplay).
 * Mic STT is optional when arecord + whisper available.
 */
import readline from "node:readline";
import { spawn } from "node:child_process";
import {
  localThink,
  localSpeak,
  localTranscribe,
  probeLocalVoiceStack,
} from "./providers/local.mjs";
import { createSpeechPlane } from "./speech-plane.mjs";

function playWav(path) {
  return new Promise((resolve) => {
    const tryBins = [
      ["ffplay", ["-nodisp", "-autoexit", "-loglevel", "quiet", path]],
      ["aplay", [path]],
      ["paplay", [path]],
    ];
    (async () => {
      for (const [bin, args] of tryBins) {
        const ok = await new Promise((res) => {
          const c = spawn(bin, args, { stdio: "ignore" });
          c.on("error", () => res(false));
          c.on("close", (code) => res(code === 0));
        });
        if (ok) return resolve({ ok: true, player: bin });
      }
      resolve({ ok: false, error: "no aplay/ffplay/paplay" });
    })();
  });
}

/**
 * Interactive text loop with optional TTS. Type /quit to exit.
 * /mic records 4s via arecord if present then transcribes.
 */
export async function runVoiceTui(cfg = {}, opts = {}) {
  const speech = createSpeechPlane();
  const probe = await probeLocalVoiceStack(cfg);
  console.log("XClaw voice TUI — local stack");
  console.log(JSON.stringify(probe, null, 2));
  console.log("Commands: /quit  /mute  /unmute  /mic  (or type a message)\n");

  const history = [];
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  const ask = (q) => new Promise((r) => rl.question(q, r));

  while (true) {
    const line = (await ask("you> ")).trim();
    if (!line) continue;
    if (line === "/quit" || line === "/exit") break;
    if (line === "/mute") {
      speech.stopTalking();
      console.log("(speech muted)");
      continue;
    }
    if (line === "/unmute") {
      speech.allowTalking();
      console.log("(speech allowed)");
      continue;
    }

    let userText = line;
    if (line === "/mic") {
      console.log("(recording 4s via arecord…)");
      const wav = `/tmp/xclaw-mic-${Date.now()}.wav`;
      const rec = await new Promise((resolve) => {
        const c = spawn(
          "arecord",
          ["-d", "4", "-f", "S16_LE", "-r", "16000", "-c", "1", wav],
          { stdio: "ignore" }
        );
        c.on("error", (e) => resolve({ ok: false, error: e.message }));
        c.on("close", (code) => resolve({ ok: code === 0, path: wav }));
      });
      if (!rec.ok) {
        console.log("mic failed:", rec.error || "arecord missing");
        continue;
      }
      const tr = await localTranscribe(rec.path, cfg);
      if (!tr.ok) {
        console.log("stt failed:", tr.error);
        continue;
      }
      userText = tr.text;
      console.log("stt>", userText);
    }

    history.push({ role: "user", content: userText });
    let reply = "";
    // Prefer full agent (tools) when a cloud/local OpenAI-compatible key path works
    const preferAgent = opts.agent !== false && (process.env.XAI_API_KEY || process.env.OPENAI_API_KEY || cfg.agent?.model);
    if (preferAgent) {
      try {
        const { runJob } = await import("../jobs/job.mjs");
        const job = await runJob({
          goal: userText,
          cfg,
          maxTurns: opts.maxTurns || 8,
          timeoutMs: opts.timeoutMs || 120_000,
          autoApprove: cfg.security?.autoApprove ?? true,
        });
        reply = String(job.text || job.error || "(no reply)").slice(0, 2000);
      } catch (e) {
        console.log("(agent fallback)", e.message || e);
        const thought = await localThink(userText, cfg, { history });
        reply = thought.text || "(no reply)";
      }
    } else {
      const thought = await localThink(userText, cfg, { history });
      reply = thought.text || "(no reply)";
    }
    history.push({ role: "assistant", content: reply });
    console.log("xclaw>", reply);

    if (!speech.isSuppressed()) {
      const begin = speech.beginSpeak(reply);
      if (begin.ok) {
        const spoken = await localSpeak(reply, cfg);
        if (spoken.ok) {
          const play = await playWav(spoken.path);
          if (!play.ok) console.log("(tts file:", spoken.path, play.error || "", ")");
        } else {
          console.log("(tts)", spoken.error);
        }
        speech.endSpeak(begin.epoch);
      }
    }
  }

  rl.close();
  console.log("bye");
}

export default { runVoiceTui };
