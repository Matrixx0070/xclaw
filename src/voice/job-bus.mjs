/**
 * Cognitive plane job bus — work continues across speech barge-in.
 */
import { randomUUID } from "node:crypto";

export function createJobBus() {
  /** @type {Map<string, object>} */
  const jobs = new Map();
  const listeners = new Set();

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

    start(partial = {}) {
      const id = partial.id || randomUUID();
      const job = {
        id,
        kind: partial.kind || "agent",
        label: partial.label || partial.kind || "job",
        status: "running",
        startedAt: Date.now(),
        progress: null,
        result: null,
        error: null,
      };
      jobs.set(id, job);
      emit({ type: "job.started", job: { ...job } });
      return id;
    },

    progress(id, progress) {
      const job = jobs.get(id);
      if (!job || job.status !== "running") return;
      job.progress = progress;
      emit({ type: "job.progress", jobId: id, progress, job: { ...job } });
    },

    complete(id, result) {
      const job = jobs.get(id);
      if (!job) return;
      job.status = "done";
      job.result = result;
      job.endedAt = Date.now();
      emit({ type: "job.done", job: { ...job } });
    },

    fail(id, error) {
      const job = jobs.get(id);
      if (!job) return;
      job.status = "failed";
      job.error = error;
      job.endedAt = Date.now();
      emit({ type: "job.failed", job: { ...job } });
    },

    /**
     * Explicit cancel — ONLY path that stops cognitive work.
     * Never called from bargeIn.
     */
    cancel(id, reason = "user_cancel") {
      const job = jobs.get(id);
      if (!job || job.status !== "running") return false;
      job.status = "cancelled";
      job.error = reason;
      job.endedAt = Date.now();
      emit({ type: "job.cancelled", job: { ...job }, reason });
      return true;
    },

    cancelAll(reason = "user_cancel_all") {
      let n = 0;
      for (const id of [...jobs.keys()]) {
        if (this.cancel(id, reason)) n++;
      }
      return n;
    },

    listActive() {
      return [...jobs.values()].filter((j) => j.status === "running");
    },

    get(id) {
      return jobs.get(id) || null;
    },
  };
}
