/**
 * Speech plane — interruptible mouth, never the brain.
 *
 * bargeIn() stops playback and advances speechEpoch only.
 * Agent/swarm/tool jobs are owned by the cognitive plane (job-bus).
 */

export function createSpeechPlane(opts = {}) {
  let speechEpoch = 0;
  let playing = false;
  let suppressed = false; // "stop talking" until next explicit speak
  const listeners = new Set();
  /** @type {Set<() => void>} */
  const stoppers = new Set();

  function emit(ev) {
    for (const fn of listeners) {
      try {
        fn(ev);
      } catch {
        /* */
      }
    }
  }

  return {
    on(fn) {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },

    getEpoch() {
      return speechEpoch;
    },

    isPlaying() {
      return playing;
    },

    isSuppressed() {
      return suppressed;
    },

    /**
     * User interrupt: mute only. Does NOT cancel agent jobs.
     */
    bargeIn(meta = {}) {
      const t0 = typeof performance !== "undefined" ? performance.now() : Date.now();
      // 1) Kill audio FIRST (before epoch/listeners) — lowest perceived latency
      for (const stop of [...stoppers]) {
        try {
          stop();
        } catch {
          /* */
        }
      }
      stoppers.clear();
      // 2) Advance epoch so in-flight beginSpeak becomes stale
      const from = speechEpoch;
      speechEpoch += 1;
      playing = false;
      const killPathMs =
        (typeof performance !== "undefined" ? performance.now() : Date.now()) - t0;
      // 3) Notify listeners (metrics / UI) after audio is already stopping
      emit({
        type: "speech.barge_in",
        epochFrom: from,
        epochTo: speechEpoch,
        jobContinue: true,
        killPathMs,
        at: Date.now(),
        ...meta,
      });
      try {
        import("./metrics.mjs").then((m) =>
          m.recordVoiceMetric("barge_in", { killPathMs })
        );
      } catch {
        /* */
      }
      return {
        speechEpoch,
        muted: true,
        jobsCancelled: false,
        killPathMs,
      };
    },

    /**
     * Playback registers a stop fn; bargeIn invokes all.
     * @param {() => void} fn
     */
    registerStopper(fn) {
      stoppers.add(fn);
      return () => stoppers.delete(fn);
    },

    /** Explicit "stop talking" — still does not cancel jobs */
    stopTalking() {
      suppressed = true;
      return this.bargeIn({ reason: "stop_talking" });
    },

    allowTalking() {
      suppressed = false;
    },

    /**
     * Begin TTS for this epoch. If epoch changes mid-play, consumer drops audio.
     */
    beginSpeak(text, { epoch } = {}) {
      if (suppressed) {
        return { ok: false, reason: "suppressed" };
      }
      const e = epoch ?? speechEpoch;
      if (e !== speechEpoch) {
        return { ok: false, reason: "stale_epoch" };
      }
      playing = true;
      emit({
        type: "speech.begin",
        epoch: e,
        text: String(text || "").slice(0, 500),
        at: Date.now(),
      });
      return { ok: true, epoch: e };
    },

    endSpeak(epoch) {
      if (epoch != null && epoch !== speechEpoch) return;
      playing = false;
      emit({ type: "speech.end", epoch: speechEpoch, at: Date.now() });
    },

    /**
     * Snapshot for metrics / doctor
     */
    metricsStub() {
      return {
        speechEpoch,
        playing,
        suppressed,
        policy: "barge_in_mutes_speech_only",
        stoppers: stoppers.size,
      };
    },
  };
}
