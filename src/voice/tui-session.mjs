/**
 * Simple TUI voice session: text in → local LLM → TTS (play if aplay/ffplay).
 * Mic STT is optional when arecord + whisper available.
 */
import readline from "node:readline";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawn } from "node:child_process";
import {
  localThink,
  localSpeak,
  localTranscribe,
  probeLocalVoiceStack,
} from "./providers/local.mjs";
import { createSpeechPlane } from "./speech-plane.mjs";
import { toSpeakableText } from "./speakable.mjs";
import { createEntente, voiceCommandsHelp } from "./entente.mjs";
import { playWav } from "./playback.mjs";

/**
 * Interactive text loop with optional TTS. Type /quit to exit.
 * /mic records 4s via arecord if present then transcribes.
 */

const DOT_OK = "\u25cf";

function pkgVersion() {
  try {
    const here = path.dirname(fileURLToPath(import.meta.url));
    return JSON.parse(fs.readFileSync(path.join(here, "..", "..", "package.json"), "utf8")).version;
  } catch {
    return null;
  }
}

function statusLine(label, ok, detail) {
  const mark = ok ? DOT_OK : "\u25cb";
  const state = ok ? "ready" : "unavailable";
  return `  ${mark} ${label.padEnd(6)} ${state.padEnd(12)}${detail ? " " + detail : ""}`;
}

/** Human-readable startup banner. `--json` still prints the raw probe. */
export function renderTuiBanner(probe = {}, cfg = {}) {
  const v = pkgVersion();
  const llm = probe.ollama || {};
  const tts = probe.tts || {};
  const stt = probe.stt || {};
  const mic = probe.capture || probe.arecord || {};
  const lines = [
    `XClaw voice TUI${v ? ` v${v}` : ""}`,
    "",
    statusLine("llm", Boolean(llm.ok && llm.hasModel !== false), llm.model || llm.url || ""),
    statusLine("tts", Boolean(tts.ok), tts.provider || ""),
    statusLine("stt", Boolean(stt.ok), stt.provider || stt.model || ""),
    statusLine("mic", Boolean(mic.ok), mic.error ? String(mic.error).slice(0, 48) : ""),
    "",
    "  type a message, or /help for commands \u00b7 /quit to exit",
    "",
  ];
  if (llm.ok && llm.hasModel === false && llm.model) {
    lines.splice(6, 0, `  note: model ${llm.model} is not pulled \u2014 \`ollama pull ${llm.model}\``);
  }
  return lines.join("\n");
}

export function tuiHelp() {
  return [
    "XClaw voice TUI \u2014 local speech loop (text in \u2192 agent \u2192 spoken reply)",
    "",
    "Usage:",
    "  xclaw voice tui [--json] [--help]",
    "",
    "Options:",
    "  --json   print the raw local-stack probe instead of the banner",
    "  --help   show this help",
    "",
    "Commands once running:",
    "  /mic            record 4s from the mic and transcribe it",
    "  /mute /unmute   suppress or restore spoken replies",
    "  /help           voice command reference",
    "  /quit           exit",
  ].join("\n");
}

export async function runVoiceTui(cfg = {}, opts = {}) {
  const speech = createSpeechPlane();
  const entente = createEntente({ speech });
  const args = opts.args || [];
  if (args.includes("--help") || args.includes("-h")) {
    console.log(tuiHelp());
    return { ok: true, help: true };
  }
  const probe = await probeLocalVoiceStack(cfg);
  if (args.includes("--json")) {
    console.log(JSON.stringify(probe, null, 2));
  } else {
    console.log(renderTuiBanner(probe, cfg));
  }

  const history = [];
  const sessionId = `voice-tui_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  const ask = (q) => new Promise((r) => rl.question(q, r));

  while (true) {
    const line = (await ask("you> ")).trim();
    if (!line) continue;
    if (line === "/quit" || line === "/exit") break;
    if (line === "/help" || line === "/voice-help" || line === "/commands") {
      console.log(voiceCommandsHelp());
      continue;
    }
    // Shared voice commands (/mute /cancel /status …)
    const classified = entente.onUserText(line);
    if (classified.intent?.kind && classified.intent.kind !== "utterance" && classified.intent.kind !== "none") {
      console.log("cmd>", classified.reply || classified.intent.kind);
      if (classified.reply && !speech.isSuppressed()) {
        const begin = speech.beginSpeak(classified.reply);
        if (begin.ok) {
          const spoken = await localSpeak(toSpeakableText(classified.reply), cfg);
          if (spoken.ok) await playWav(spoken.path, { speech, epoch: begin.epoch });
          else speech.endSpeak(begin.epoch);
        }
      }
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
        // Same auto-promote as /ws/voice and the TUI: a turn-cap cutoff is an
        // execution constraint, not completion. Voice TUI used runJob (already
        // persistRun by default) then printed/spoke the truncated reply.
        // Distinct from closed /ws/voice. Do not mint persistRun.
        // Voice TUI stays alive, so the mission is detached (not CLI awaitRun).
        if (cfg.objectives?.enabled !== false) {
          try {
            const { autoPromoteIfNeeded, formatPromotedReply } = await import(
              "../channels/runtime.mjs"
            );
            const { replyWithAgent } = await import("../channels/base.mjs");
            const promo = await autoPromoteIfNeeded({
              text: userText,
              inbound: {
                channel: "voice-tui",
                chatId: sessionId,
                userId: sessionId,
                identity: `voice-tui:${sessionId}`,
              },
              cfg,
              workingDir: process.cwd(),
              replyWithAgent,
              onEvent: (e) => {
                if (e?.type === "objective" && e.phase === "promote_error") {
                  console.log("(promote failed)", e.message || "error");
                }
              },
              notify: async (t) => {
                const notice = String(t || "").trim();
                if (!notice) return;
                console.log("xclaw>", notice);
              },
              turnResult: {
                stopReason: job.stopReason,
                text: job.text,
                toolTrace: job.toolTrace,
              },
            });
            if (promo) {
              reply = formatPromotedReply(job.text, promo.id).slice(0, 2000);
            }
          } catch (err) {
            console.log("(promote failed)", err.message || err);
          }
        }
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
        const spoken = await localSpeak(toSpeakableText(reply), cfg);
        if (spoken.ok) {
          const play = await playWav(spoken.path, { speech, epoch: begin.epoch });
          if (!play.ok && !play.interrupted) {
            console.log("(tts file:", spoken.path, play.error || "", ")");
          }
        } else {
          console.log("(tts)", spoken.error);
          speech.endSpeak(begin.epoch);
        }
      }
    }
  }

  rl.close();
  console.log("bye");
}

export default { runVoiceTui };
