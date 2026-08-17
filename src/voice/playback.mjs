/**
 * Interruptible local audio playback — optimized for low barge-in latency.
 *
 * Kill path goals:
 *  - stoppers run synchronously on barge-in (no await)
 *  - process group SIGKILL (not polite SIGTERM wait)
 *  - kill even if promise already settling
 */

import { spawn } from "node:child_process";
import fs from "node:fs";

/**
 * Hard-kill player process tree as fast as possible (Unix process group).
 * @param {import('node:child_process').ChildProcess | null} child
 */
export function killPlayerFast(child) {
  if (!child || child.killed) return { killed: false };
  const pid = child.pid;
  if (!pid) return { killed: false };
  const t0 = performance.now();
  try {
    // Process group when spawned detached
    try {
      process.kill(-pid, "SIGKILL");
    } catch {
      try {
        child.kill("SIGKILL");
      } catch {
        try {
          process.kill(pid, "SIGKILL");
        } catch {
          /* */
        }
      }
    }
  } catch {
    /* */
  }
  return { killed: true, pid, killMs: performance.now() - t0 };
}

/**
 * @param {string} filePath
 * @param {{ speech?: object, epoch?: number, signal?: AbortSignal }} [opts]
 */
export function playWavInterruptible(filePath, opts = {}) {
  const speech = opts.speech || null;
  const epoch = opts.epoch ?? speech?.getEpoch?.();
  let child = null;
  let settled = false;
  let unsub = null;
  let unregStopper = null;
  let abortHandler = null;
  let lastKill = null;

  const killNow = () => {
    lastKill = killPlayerFast(child);
    child = null;
    return lastKill;
  };

  const cleanup = () => {
    if (unsub) {
      try {
        unsub();
      } catch {
        /* */
      }
      unsub = null;
    }
    if (unregStopper) {
      try {
        unregStopper();
      } catch {
        /* */
      }
      unregStopper = null;
    }
    if (abortHandler && opts.signal) {
      opts.signal.removeEventListener("abort", abortHandler);
      abortHandler = null;
    }
  };

  const stop = (reason = "barge_in") => {
    // Always kill first — do not gate on settled
    killNow();
    return reason;
  };

  const promise = new Promise((resolve) => {
    const finish = (result) => {
      if (settled) return;
      settled = true;
      cleanup();
      if (speech && epoch != null) {
        try {
          speech.endSpeak(epoch);
        } catch {
          /* */
        }
      }
      if (lastKill?.killMs != null) {
        result = { ...result, killMs: lastKill.killMs };
      }
      resolve(result);
    };

    if (speech && epoch != null && speech.getEpoch() !== epoch) {
      finish({ ok: false, interrupted: true, reason: "stale_epoch" });
      return;
    }

    if (speech) {
      // Prefer stopper path (runs inside bargeIn before emit returns)
      if (typeof speech.registerStopper === "function") {
        unregStopper = speech.registerStopper(() => {
          stop("barge_in");
          finish({
            ok: false,
            interrupted: true,
            reason: "barge_in",
            fast: true,
          });
        });
      }
      // Backup listener if barge_in emitted without stopper (tests)
      unsub = speech.on((ev) => {
        if (ev.type === "speech.barge_in") {
          stop("barge_in");
          finish({
            ok: false,
            interrupted: true,
            reason: "barge_in",
            epochFrom: ev.epochFrom,
            epochTo: ev.epochTo,
            fast: false,
          });
        }
      });
    }

    if (opts.signal) {
      if (opts.signal.aborted) {
        finish({ ok: false, interrupted: true, reason: "aborted" });
        return;
      }
      abortHandler = () => {
        stop("aborted");
        finish({ ok: false, interrupted: true, reason: "aborted" });
      };
      opts.signal.addEventListener("abort", abortHandler, { once: true });
    }

    try {
      fs.accessSync(filePath);
    } catch {
      finish({ ok: false, error: "file_not_found", path: filePath });
      return;
    }

    const tryBins = [
      ["ffplay", ["-nodisp", "-autoexit", "-loglevel", "quiet", "-fflags", "nobuffer", filePath]],
      ["aplay", ["-q", filePath]],
      ["paplay", [filePath]],
    ];

    const tryNext = (i) => {
      if (settled) return;
      if (i >= tryBins.length) {
        finish({ ok: false, error: "no aplay/ffplay/paplay" });
        return;
      }
      if (speech && epoch != null && speech.getEpoch() !== epoch) {
        finish({ ok: false, interrupted: true, reason: "stale_epoch" });
        return;
      }
      const [bin, args] = tryBins[i];
      // detached → new process group so SIGKILL -pid stops the tree immediately
      child = spawn(bin, args, {
        stdio: "ignore",
        detached: process.platform !== "win32",
      });
      child.unref?.();
      child.on("error", () => {
        child = null;
        tryNext(i + 1);
      });
      child.on("close", (code, signal) => {
        child = null;
        if (settled) return;
        if (signal === "SIGTERM" || signal === "SIGKILL") {
          finish({
            ok: false,
            interrupted: true,
            reason: "killed",
            signal,
            killMs: lastKill?.killMs,
          });
          return;
        }
        if (code === 0) {
          finish({ ok: true, player: bin });
        } else {
          tryNext(i + 1);
        }
      });
    };

    tryNext(0);
  });

  return {
    promise,
    stop: () => {
      stop("manual");
    },
    getLastKill: () => lastKill,
  };
}

/** Awaitable helper */
export async function playWav(filePath, opts = {}) {
  const { promise } = playWavInterruptible(filePath, opts);
  return promise;
}

export default { playWav, playWavInterruptible, killPlayerFast };
