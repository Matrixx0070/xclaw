/**
 * Live Voice Agent runtime — conversation + full autonomous system control.
 *
 * Model: OpenAI-style voice agent templates + XClaw computer/swarm tools.
 * Policy: speakWhileTools (mouth ‖ mind) via entente dual-plane.
 */
import { randomUUID } from "node:crypto";
import { getVoiceAgentPreset } from "./presets.mjs";
import { createEntente, classifyVoiceIntent } from "../entente.mjs";

/**
 * @typedef {object} VoiceAgentOptions
 * @property {string} [preset] — personal_assistant | customer_support | …
 * @property {object} [cfg]
 * @property {object} [tools] — map name → { execute(args) }
 * @property {(text: string, meta?: object) => Promise<void>|void} [speak]
 * @property {(prompt: string, ctx: object) => Promise<{ text: string, toolCalls?: object[] }>} [think]
 */

export function createVoiceAgent(opts = {}) {
  const preset = getVoiceAgentPreset(opts.preset || "personal_assistant");
  const entente = createEntente({
    narrateProgress: preset.voice?.speakWhileTools !== false,
  });
  const sessionId = randomUUID();
  const history = [];
  let busyTools = 0;

  const tools = opts.tools || {};
  const allowed = new Set(preset.tools || []);

  async function speak(text, meta = {}) {
    const t = String(text || "").trim();
    if (!t) return;
    const clipped = t.slice(0, preset.voice?.maxSpeakChars || 400);
    const begin = entente.speech.beginSpeak(clipped);
    if (!begin.ok) return;
    if (opts.speak) {
      try {
        await opts.speak(clipped, { ...meta, epoch: begin.epoch, sessionId });
      } finally {
        entente.speech.endSpeak(begin.epoch);
      }
    } else {
      entente.speech.endSpeak(begin.epoch);
    }
  }

  async function runTool(name, args) {
    if (allowed.size && !allowed.has(name)) {
      return { ok: false, error: `tool not allowed for preset: ${name}` };
    }
    const fn = tools[name];
    if (!fn?.execute && typeof fn !== "function") {
      return { ok: false, error: `tool not registered: ${name}` };
    }
    const jobId = entente.jobs.start({
      kind: "tool",
      label: name,
    });
    busyTools++;
    try {
      if (preset.voice?.preamble && preset.voice?.speakWhileTools) {
        await speak(`Working on ${name.replace(/^xclaw_/, "").replace(/_/g, " ")}.`);
      }
      const execute = fn.execute || fn;
      const result = await execute(args || {});
      entente.jobs.complete(jobId, result);
      return { ok: true, result };
    } catch (e) {
      const err = e.message || String(e);
      entente.jobs.fail(jobId, err);
      return { ok: false, error: err };
    } finally {
      busyTools = Math.max(0, busyTools - 1);
    }
  }

  /**
   * Handle a final user utterance (from STT or text fallback).
   */
  async function handleUserUtterance(text) {
    const intent = classifyVoiceIntent(text);
    const classified = entente.onUserText(text);

    if (intent.kind === "stop_talking") {
      return { ok: true, intent, spoke: false };
    }
    if (intent.kind === "cancel_job") {
      await speak(
        classified.jobsCancelled
          ? "Cancelled background work."
          : "Nothing active to cancel."
      );
      return { ok: true, intent, jobsCancelled: classified.jobsCancelled };
    }
    if (intent.kind === "keep_going") {
      return { ok: true, intent };
    }

    history.push({ role: "user", content: text, at: Date.now() });

    // Think (LLM) — may return tool calls
    let reply = "";
    let toolCalls = [];
    if (opts.think) {
      const out = await opts.think(text, {
        sessionId,
        preset: preset.id,
        instructions: preset.instructions,
        history: history.slice(-12),
        activeJobs: entente.jobs.listActive(),
        systemControl: preset.systemControl,
      });
      reply = out?.text || "";
      toolCalls = out?.toolCalls || [];
    } else {
      reply =
        preset.systemControl
          ? "Understood. Connect a think() model to run full system actions."
          : "Understood.";
    }

    // Run tools autonomously (parallel mind); speech can interleave
    const toolResults = [];
    for (const tc of toolCalls) {
      const name = tc.name || tc.tool;
      const args = tc.arguments || tc.args || {};
      const r = await runTool(name, args);
      toolResults.push({ name, ...r });
    }

    if (toolResults.length && !reply) {
      reply = toolResults.every((r) => r.ok)
        ? "Done."
        : "Finished with some errors.";
    }

    if (reply) {
      history.push({ role: "assistant", content: reply, at: Date.now() });
      await speak(reply);
    }

    return {
      ok: true,
      intent: intent.kind,
      reply,
      toolResults,
      activeJobs: entente.jobs.listActive().length,
      speechEpoch: entente.speech.getEpoch(),
    };
  }

  return {
    sessionId,
    preset,
    entente,
    handleUserUtterance,
    bargeIn: (meta) => entente.onBargeIn(meta),
    runTool,
    speak,
    getHistory: () => [...history],
    status() {
      return {
        sessionId,
        preset: preset.id,
        systemControl: preset.systemControl,
        autonomy: preset.autonomy,
        activeJobs: entente.jobs.listActive(),
        busyTools,
        speech: entente.speech.metricsStub(),
      };
    },
  };
}
