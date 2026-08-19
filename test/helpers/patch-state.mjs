/**
 * Patch-state assertions for the ship-patch tests.
 *
 * The original tests asserted `git apply --check <patch>` exits 0, i.e. that
 * the patch is still PENDING. That inverts once the feature actually ships:
 * a landed patch can never apply again, so the test fails precisely because
 * the work is done. These helpers assert the weaker, correct property — the
 * change is either already in the tree or still applies cleanly — so they hold
 * both before and after landing.
 */
import { spawnSync } from "node:child_process";
import fs from "node:fs";

const git = (root, args) => spawnSync("git", args, { cwd: root, encoding: "utf8" });

export function patchState(root, patchFile) {
  if (!fs.existsSync(patchFile)) return "missing";
  if (git(root, ["apply", "--check", patchFile]).status === 0) return "appliable";
  if (git(root, ["apply", "--reverse", "--check", patchFile]).status === 0) return "landed";
  return "stale";
}

/**
 * @param {string} root
 * @param {string} patchFile
 * @param {string[]} [needles] source markers proving the change is in the tree
 *   when the patch text itself has drifted (hand-landed against a moved tree).
 */
export function assertPatchLandedOrAppliable(assert, root, patchFile, needles = []) {
  const state = patchState(root, patchFile);
  if (state === "appliable" || state === "landed") return state;
  if (needles.length) {
    const missing = needles.filter(([rel, needle]) => {
      try {
        return !fs.readFileSync(`${root}/${rel}`, "utf8").includes(needle);
      } catch {
        return true;
      }
    });
    assert.deepEqual(missing, [], `patch ${patchFile} is ${state} and needles missing: ${JSON.stringify(missing)}`);
    return "landed-by-needle";
  }
  assert.fail(`patch ${patchFile} is ${state} (neither appliable nor already landed)`);
}

export default { patchState, assertPatchLandedOrAppliable };
