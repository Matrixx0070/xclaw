/**
 * Interruptible local audio playback.
 * Binds to a speech plane: barge_in / epoch change kills the player process.
 */

import { spawn } from "node:child_process";
import fs from "node:fs";

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
  let abortHandler = null;

  const stop = (reason = "barge_in") => {
    if (settled) return;
    if (child && !child.killed) {
      try {
        child.kill("SIGTERM");
      } catch {
        try {
          child.kill("SIGKILL");
        } catch {
          /* */
        }
      }
    }
    cleanup();
  };

  let unregStopper = null;
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
      resolve(result);
    };

    // Already stale?
    if (speech && epoch != null && speech.getEpoch() !== epoch) {
      finish({ ok: false, interrupted: true, reason: "stale_epoch" });
      return;
    }

    if (speech) {
      unsub = speech.on((ev) => {
        if (ev.type === "speech.barge_in") {
          stop("barge_in");
          finish({
            ok: false,
            interrupted: true,
            reason: "barge_in",
            epochFrom: ev.epochFrom,
            epochTo: ev.epochTo,
          });
        }
      });
      if (typeof speech.registerStopper === "function") {
        unregStopper = speech.registerStopper(() => stop("barge_in"));
      }
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
      ["ffplay", ["-nodisp", "-autoexit", "-loglevel", "quiet", filePath]],
      ["aplay", [filePath]],
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
      child = spawn(bin, args, { stdio: "ignore" });
      child.on("error", () => {
        child = null;
        tryNext(i + 1);
      });
      child.on("close", (code, signal) => {
        child = null;
        if (settled) return;
        if (signal === "SIGTERM" || signal === "SIGKILL") {
          finish({ ok: false, interrupted: true, reason: "killed", signal });
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
    stop: () => stop("manual"),
  };
}

/** Awaitable helper */
export async function playWav(filePath, opts = {}) {
  const { promise } = playWavInterruptible(filePath, opts);
  return promise;
}

export default { playWav, playWavInterruptible };
