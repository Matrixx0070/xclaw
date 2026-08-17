/**
 * W1 — Continuous local listen loop.
 *
 * Cycle:
 *   1. Short record (wake window)
 *   2. Energy gate → STT → wake phrase?
 *   3. On hit: record command window (longer)
 *   4. STT → voice commands / agent / optional TTS
 *
 * Ctrl+C to stop. Requires arecord + local STT for full path.
 */

import {
  wakeConfig,
  recordClip,
  probeWakeOnce,
  matchWakePhrase,
  wavRmsEnergy,
} from "./index.mjs";
import {
  localTranscribe,
  localSpeak,
} from "../providers/local.mjs";
import { createEntente, voiceCommandsHelp } from "../entente.mjs";
import fs from "node:fs/promises";
import { playWav } from "../playback.mjs";
import { routeVoiceUtterance, casualReply } from "../router.mjs";
import { sendUtteranceToGateway } from "../gateway-bridge.mjs";
import { recordUntilEndpoint } from "../vad.mjs";
import { speakSentences } from "../sentence-tts.mjs";
import { streamSpeakReply, shouldStreamVoiceReply } from "../stream-reply.mjs";

/**
 * @param {object} cfg
 * @param {object} [opts]
 * @param {boolean} [opts.agent] use full agent when keys present
 * @param {boolean} [opts.speak] TTS replies
 * @param {number} [opts.commandSeconds] post-wake record length
 * @param {(ev: object) => void} [opts.onEvent]
 * @param {AbortSignal} [opts.signal]
 */
export async function runVoiceListen(cfg = {}, opts = {}) {
  const c = wakeConfig(cfg);
  const commandSeconds =
    opts.commandSeconds ?? c.commandSeconds ?? cfg.voice?.wake?.commandSeconds ?? 4;
  const speakReplies = opts.speak !== false;
  const entente = createEntente();
  const onEvent = opts.onEvent || ((ev) => console.log(JSON.stringify(ev)));

  console.log("XClaw voice listen (W1) — say a wake phrase, then your command");
  console.log("Phrases:", c.phrases.join(" | "));
  console.log("Ctrl+C to stop · /commands for help in post-wake speech\n");

  let cycles = 0;
  let hits = 0;
  let stopped = false;

  const stop = () => {
    stopped = true;
  };
  if (opts.signal) {
    if (opts.signal.aborted) return { cycles, hits, stopped: true };
    opts.signal.addEventListener("abort", stop, { once: true });
  }
  process.once("SIGINT", stop);

  while (!stopped) {
    cycles += 1;
    onEvent({ type: "listen.cycle", cycles, hits });

    // Optional VAD-based wake capture (voice.vad.wake === true)
    let wake;
    const wakeVad = cfg.voice?.vad?.wake === true || opts.wakeVad === true;
    if (wakeVad) {
      const cap = await recordUntilEndpoint({
        cfg,
        sampleRate: c.sampleRate,
        threshold: c.energyThreshold,
        maxMs: (c.recordSeconds || 2) * 1000 + 1500,
        silenceMs: cfg.voice?.vad?.wakeSilenceMs || 350,
        prerollMs: cfg.voice?.vad?.wakePrerollMs || 3000,
      });
      if (cap.ok && cap.path) {
        const { localTranscribe } = await import("../providers/local.mjs");
        const { matchWakePhrase } = await import("./index.mjs");
        const tr = await localTranscribe(cap.path, cfg);
        const match = matchWakePhrase(tr.text || "", c.phrases);
        wake = {
          ok: true,
          aboveThreshold: true,
          hit: match.hit,
          phrase: match.phrase,
          transcript: match.transcript || tr.text,
          energy: cap.energyPeak,
          path: cap.path,
          stage: "vad_wake",
        };
      } else {
        wake = {
          ok: true,
          aboveThreshold: false,
          hit: false,
          reason: cap.reason || "no_speech",
          energy: cap.energyPeak || 0,
        };
      }
    } else {
      wake = await probeWakeOnce(cfg, {
        seconds: c.recordSeconds,
        energyThreshold: c.energyThreshold,
      });
    }

    if (stopped) break;

    if (!wake.ok && wake.stage === "record") {
      onEvent({ type: "listen.record_error", error: wake.error });
      console.error("[listen] record failed:", wake.error);
      await sleep(1500);
      continue;
    }

    if (!wake.aboveThreshold) {
      // quiet room — brief pause
      await sleep(200);
      continue;
    }

    if (!wake.hit) {
      onEvent({
        type: "listen.no_wake",
        energy: wake.energy,
        transcript: wake.transcript,
      });
      continue;
    }

    hits += 1;
    onEvent({
      type: "listen.wake",
      phrase: wake.phrase,
      transcript: wake.transcript,
      energy: wake.energy,
    });
    console.log(`[wake] ${wake.phrase} ← "${wake.transcript}"`);

    // Acknowledge wake lightly
    if (speakReplies && !entente.speech.isSuppressed()) {
      const ack = await localSpeak("Yes?", cfg);
      if (ack.ok) await playWav(ack.path, { speech: entente.speech });
    }

    // Command window — VAD endpoint (silence) instead of fixed duration
    const useVad = opts.vad !== false && cfg.voice?.vad?.enabled !== false;
    let cmdRec;
    if (useVad) {
      cmdRec = await recordUntilEndpoint({
        cfg,
        sampleRate: c.sampleRate,
        threshold: c.energyThreshold,
        maxMs: (opts.commandSeconds || commandSeconds) * 1000,
        silenceMs: opts.silenceMs || cfg.voice?.vad?.silenceMs || 450,
        prerollMs: opts.prerollMs || cfg.voice?.vad?.prerollMs || 2500,
      });
      onEvent({
        type: "listen.vad",
        reason: cmdRec.reason,
        durationMs: cmdRec.durationMs,
        speechMs: cmdRec.speechMs,
        energyPeak: cmdRec.energyPeak,
      });
      if (cmdRec.ok) {
        console.log(
          `[vad] endpoint reason=${cmdRec.reason} dur=${cmdRec.durationMs}ms speech=${cmdRec.speechMs}ms peak=${cmdRec.energyPeak}`
        );
      }
    } else {
      cmdRec = await recordClip({
        seconds: commandSeconds,
        sampleRate: c.sampleRate,
      });
    }
    if (stopped) break;
    if (!cmdRec.ok) {
      console.error(
        "[listen] command record failed:",
        cmdRec.error || cmdRec.reason
      );
      if (cmdRec.reason === "no_speech" || cmdRec.reason === "preroll_timeout") {
        console.log("[listen] no speech after wake");
        onEvent({ type: "listen.command_silent", reason: cmdRec.reason });
      }
      continue;
    }

    const tr = await localTranscribe(cmdRec.path, cfg);
    if (!tr.ok || !tr.text) {
      onEvent({ type: "listen.stt_fail", error: tr.error });
      console.log("[listen] STT failed:", tr.error || "empty");
      continue;
    }

    const userText = tr.text.trim();
    console.log(`[you] ${userText}`);
    onEvent({ type: "listen.utterance", text: userText });

    const route = routeVoiceUtterance(userText);
    onEvent({ type: "listen.route", mode: route.mode });

    // Voice commands first
    if (route.mode === "command") {
      const classified = entente.onUserText(userText);
      const reply = classified.reply || classified.intent?.kind || "ok";
      console.log(`[cmd] ${reply}`);
      if (speakReplies && reply && !entente.speech.isSuppressed()) {
        const r = await speakSentences(reply, cfg, { speech: entente.speech });
        onEvent({ type: "listen.tts", firstAudioMs: r.firstAudioMs, sentences: r.sentences });
        entente.setLastSpoken(reply);
      }
      continue;
    }

    // Optional gateway bridge
    if (opts.gateway || process.env.XCLAW_VOICE_WS || process.env.XCLAW_GATEWAY_WS) {
      const g = await sendUtteranceToGateway(userText, {
        url: opts.gatewayUrl || process.env.XCLAW_VOICE_WS || process.env.XCLAW_GATEWAY_WS,
        speak: false,
      });
      if (g.ok && g.reply) {
        console.log(`[gateway] ${String(g.reply).slice(0, 500)}`);
        onEvent({ type: "listen.reply", text: String(g.reply).slice(0, 500), via: "gateway" });
        entente.setLastSpoken(g.reply);
        if (speakReplies && !entente.speech.isSuppressed()) {
          const r = await speakSentences(g.reply, cfg, { speech: entente.speech });
          onEvent({ type: "listen.tts", firstAudioMs: r.firstAudioMs, via: "gateway" });
        }
        continue;
      }
    }

    // Casual path — no tools, minimal latency
    let reply = "";
    if (route.mode === "casual" && opts.agent !== true) {
      reply = casualReply(userText);
      console.log(`[casual] ${reply}`);
    } else {
      const preferAgent =
        opts.agent !== false &&
        (process.env.XAI_API_KEY ||
          process.env.OPENAI_API_KEY ||
          cfg.agent?.model);
      try {
        if (
          preferAgent &&
          opts.stream !== false &&
          shouldStreamVoiceReply(userText, route.mode) &&
          speakReplies
        ) {
          const streamed = await streamSpeakReply(userText, cfg, {
            speech: entente.speech,
          });
          if (streamed.ok && streamed.text) {
            reply = streamed.text;
            console.log(`[xclaw:stream] ${reply.slice(0, 500)}`);
            onEvent({
              type: "listen.reply",
              text: reply.slice(0, 500),
              streamed: true,
              firstAudioMs: streamed.firstAudioMs,
            });
            entente.setLastSpoken(reply);
            continue; // already spoke via sentence stream
          }
          // fall through to job/local on stream failure
          if (streamed.error) {
            onEvent({ type: "listen.stream_fallback", error: streamed.error });
          }
        }
        if (preferAgent) {
          const { runJob } = await import("../../jobs/job.mjs");
          const job = await runJob({
            goal: userText,
            cfg,
            maxTurns: opts.maxTurns || 8,
            timeoutMs: opts.timeoutMs || 120_000,
            autoApprove: cfg.security?.autoApprove ?? true,
          });
          reply = String(job.text || job.error || "").slice(0, 2000);
        } else {
          const { localThink } = await import("../providers/local.mjs");
          const thought = await localThink(userText, cfg, { history: [] });
          reply = thought.text || "(no reply)";
        }
      } catch (e) {
        reply = `Error: ${e.message || e}`;
      }
    }

    console.log(`[xclaw] ${reply.slice(0, 500)}`);
    onEvent({ type: "listen.reply", text: reply.slice(0, 500) });
    entente.setLastSpoken(reply);

    if (speakReplies && reply && !entente.speech.isSuppressed()) {
      const r = await speakSentences(reply, cfg, { speech: entente.speech });
      onEvent({ type: "listen.tts", firstAudioMs: r.firstAudioMs, sentences: r.sentences });
    }
  }

  console.log(`\n[listen] stopped · cycles=${cycles} wakes=${hits}`);
  return { cycles, hits, stopped: true };
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

export default { runVoiceListen };
