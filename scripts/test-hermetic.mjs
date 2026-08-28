#!/usr/bin/env node
/**
 * `npm test` — the unit suite under a hermetic HOME.
 *
 * Runs `node --test` with HOME redirected at a throwaway directory, so any
 * home-default path a test resolves (~/.xclaw/**) lands there instead of the
 * operator's real home. See scripts/hermetic-home.mjs for why this is the
 * seam. Output is inherited unchanged, so the TAP summary — and the `# fail 0`
 * ship gate that greps it — behaves exactly as before.
 *
 * Extra args are passed through as the file list, so
 * `npm test -- test/one.test.mjs` still works.
 */
import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  createHermeticHome,
  hermeticEnv,
  listHomeWrites,
  removeHermeticHome,
} from "./hermetic-home.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const patterns = process.argv.slice(2);
// node --test expands the glob itself (Node 22+), so sh globstar is irrelevant.
const args = ["--test", ...(patterns.length ? patterns : ["test/**/*.test.mjs"])];

const home = createHermeticHome();
let code = 1;
try {
  const res = spawnSync(process.execPath, args, {
    cwd: root,
    env: hermeticEnv(process.env, home),
    stdio: "inherit",
  });
  code = res.status ?? 1;
  const writes = listHomeWrites(home);
  // A TAP comment, so it cannot be mistaken for a plan or a result line.
  console.log(
    `# hermetic HOME: ${writes.length} file(s) written to home defaults, real home untouched`
  );
  if (process.env.XCLAW_TEST_HOME_VERBOSE === "1") {
    for (const w of writes) console.log(`#   ${w}`);
  }
} finally {
  removeHermeticHome(home);
}
process.exit(code);
