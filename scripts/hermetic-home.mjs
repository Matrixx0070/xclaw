/**
 * A hermetic HOME for test runs.
 *
 * 114 call sites under src/ resolve a path from os.homedir(), almost all of
 * them ~/.xclaw/<something>. A test that forgets to pass a cfg, set
 * XCLAW_STATE_DIR, or redirect the relevant XCLAW_*_DIR therefore writes into
 * the operator's real home. v3.310.0 chased three such leaks one file at a
 * time and left the class open: containment was per-test-file discipline, so
 * the next test to call a home-default writer re-opened the hole silently.
 *
 * This closes it at the only seam that covers all 114 at once. On POSIX
 * os.homedir() returns $HOME when it is set, so pointing HOME at a throwaway
 * directory for the duration of the test process makes every home-default path
 * resolve inside that directory. Child processes inherit it, so tests that
 * spawn bin/xclaw.mjs are covered too.
 *
 * Prevention, not detection. listHomeWrites() exists so the run can report
 * what landed at home defaults, but a write there is no longer a defect to
 * gate on — it cannot reach the operator, and gating would mean maintaining an
 * allowlist of the paths the suite legitimately touches.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

export function createHermeticHome() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "xclaw-test-home-"));
}

/**
 * HOME is the only variable that matters: os.homedir() consults it first, and
 * every helper that builds ~/.xclaw goes through os.homedir(). Returning a new
 * object rather than mutating process.env keeps the caller's own environment
 * intact — the wrapper still has to reach the real home to clean up.
 */
export function hermeticEnv(env, home) {
  return { ...env, HOME: home };
}

/** Relative paths of every file the run left behind, for the census line. */
export function listHomeWrites(home) {
  const out = [];
  const walk = (dir, rel) => {
    let entries;
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const next = rel ? `${rel}/${entry.name}` : entry.name;
      if (entry.isDirectory()) walk(path.join(dir, entry.name), next);
      else out.push(next);
    }
  };
  walk(home, "");
  return out.sort();
}

export function removeHermeticHome(home) {
  if (!home) return;
  fs.rmSync(home, { recursive: true, force: true });
}
