/**
 * Entente — bind speech plane + job bus.
 * Talk and work in parallel; barge-in never cancels jobs.
 */
import { createSpeechPlane } from "./speech-plane.mjs";
import { createJobBus } from "./job-bus.mjs";
import {
  classifyVoiceIntent,
  voiceCommandsHelp,
  VOICE_COMMANDS,
} from "./commands.mjs";

export { classifyVoiceIntent, voiceCommandsHelp, VOICE_COMMANDS };

export function createEntente(opts = {}) {
  const speech = createSpeechPlane(opts.speech);
  const jobs = createJobBus();
  const narrateProgress = opts.narrateProgress !== false;
  let lastSpoken = "";

  if (narrateProgress) {
    jobs.on((ev) => {
      if (ev.type === "job.progress" && ev.progress?.message) {
        speech.beginSpeak(String(ev.progress.message).slice(0, 120));
      }
    });
  }

  return {
    speech,
    jobs,

    getLastSpoken() {
      return lastSpoken;
    },

    setLastSpoken(t) {
      lastSpoken = String(t || "").slice(0, 2000);
    },

    onBargeIn(meta) {
      return speech.bargeIn(meta);
    },

    /**
     * Handle a committed user transcript / slash command.
     * @returns {{ intent, jobsCancelled?: number, reply?: string, active?: number }}
     */
    onUserText(text) {
      const intent = classifyVoiceIntent(text);

      if (intent.kind === "stop_talking" || intent.kind === "barge_in") {
        if (intent.kind === "stop_talking") speech.stopTalking();
        else speech.bargeIn({ reason: "barge_in_command" });
        return {
          intent,
          jobsCancelled: 0,
          reply: intent.command?.reply || "Muted.",
        };
      }

      if (intent.kind === "allow_talking") {
        speech.allowTalking();
        return { intent, jobsCancelled: 0, reply: "Speech on." };
      }

      if (intent.kind === "cancel_job") {
        const n = jobs.cancelAll("user_cancel");
        speech.allowTalking();
        const reply = n ? `Cancelled ${n} job(s).` : "Nothing to cancel.";
        speech.beginSpeak(reply);
        return { intent, jobsCancelled: n, reply };
      }

      if (intent.kind === "keep_going") {
        speech.allowTalking();
        const active = jobs.listActive();
        const reply = active.length
          ? `Still working on ${active.length} job(s).`
          : "Understood — continuing.";
        speech.beginSpeak(reply);
        return { intent, jobsCancelled: 0, active: active.length, reply };
      }

      if (intent.kind === "status") {
        speech.allowTalking();
        const active = jobs.listActive();
        const reply = [
          speech.isSuppressed() ? "Speech muted." : "Speech on.",
          active.length ? `${active.length} active job(s).` : "No active jobs.",
          `Epoch ${speech.getEpoch()}.`,
        ].join(" ");
        speech.beginSpeak(reply);
        return { intent, jobsCancelled: 0, reply, active: active.length };
      }

      if (intent.kind === "help") {
        speech.allowTalking();
        const reply =
          "Voice commands: stop talking, cancel, continue, status, repeat, unmute. " +
          "Slash: /mute /unmute /cancel /status /repeat";
        return { intent, jobsCancelled: 0, reply, help: voiceCommandsHelp() };
      }

      if (intent.kind === "repeat") {
        speech.allowTalking();
        const reply = lastSpoken || "Nothing to repeat yet.";
        speech.beginSpeak(reply.slice(0, 400));
        return { intent, jobsCancelled: 0, reply };
      }

      // utterance: cognitive plane handles; speech must not cancel jobs
      speech.allowTalking();
      return { intent, jobsCancelled: 0 };
    },

    assertBargeInDoesNotCancelJobs() {
      const before = jobs.listActive().map((j) => j.id);
      speech.bargeIn({ test: true });
      const after = jobs.listActive().map((j) => j.id);
      return {
        ok:
          before.length === after.length &&
          before.every((id, i) => id === after[i]),
        before,
        after,
      };
    },
  };
}
