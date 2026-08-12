/**
 * Entente — bind speech plane + job bus.
 * Talk and work in parallel; barge-in never cancels jobs.
 */
import { createSpeechPlane } from "./speech-plane.mjs";
import { createJobBus } from "./job-bus.mjs";

/**
 * Classify user text for cancel vs mute vs new work (lightweight).
 */
export function classifyVoiceIntent(text) {
  const t = String(text || "").toLowerCase().trim();
  if (!t) return { kind: "none" };
  if (
    /\b(stop talking|shut up|be quiet|silence)\b/.test(t)
  ) {
    return { kind: "stop_talking" };
  }
  if (
    /\b(cancel( that| it| the)?( task| job| swarm| research)?|stop (the )?(task|job|swarm|agent|work)|abort)\b/.test(
      t
    )
  ) {
    return { kind: "cancel_job" };
  }
  if (/\b(keep going|continue|don't stop|carry on)\b/.test(t)) {
    return { kind: "keep_going" };
  }
  return { kind: "utterance" };
}

export function createEntente(opts = {}) {
  const speech = createSpeechPlane(opts.speech);
  const jobs = createJobBus();
  const narrateProgress = opts.narrateProgress !== false;

  // Optional: soft status lines without blocking jobs
  if (narrateProgress) {
    jobs.on((ev) => {
      if (ev.type === "job.progress" && ev.progress?.message) {
        // Only suggest speech — caller decides; never blocks job
        speech.beginSpeak(String(ev.progress.message).slice(0, 120));
      }
    });
  }

  return {
    speech,
    jobs,

    /** Interrupt speech only */
    onBargeIn(meta) {
      return speech.bargeIn(meta);
    },

    /** Handle a committed user transcript */
    onUserText(text) {
      const intent = classifyVoiceIntent(text);
      if (intent.kind === "stop_talking") {
        speech.stopTalking();
        return { intent, jobsCancelled: 0 };
      }
      if (intent.kind === "cancel_job") {
        const n = jobs.cancelAll("user_cancel");
        speech.allowTalking();
        speech.beginSpeak(n ? "Cancelled." : "Nothing to cancel.");
        return { intent, jobsCancelled: n };
      }
      if (intent.kind === "keep_going") {
        speech.allowTalking();
        const active = jobs.listActive();
        speech.beginSpeak(
          active.length
            ? `Still working on ${active.length} job(s).`
            : "Understood."
        );
        return { intent, jobsCancelled: 0, active: active.length };
      }
      // utterance: cognitive plane handles; speech must not cancel jobs
      speech.allowTalking();
      return { intent, jobsCancelled: 0 };
    },

    /**
     * Invariant check for tests / doctor
     */
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
