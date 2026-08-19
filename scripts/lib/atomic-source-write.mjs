/**
 * Atomic, no-op-when-unchanged source writes for the apply-* patch scripts.
 *
 * These scripts are invoked concurrently by ~34 test files. Each one did
 * read → transform → fs.writeFileSync on shared files under src/. writeFileSync
 * truncates before it writes, so a second process reading the same path could
 * observe an empty file, transform that, and write the emptiness back —
 * src/eval/horizon-offline.mjs was reduced from 413 lines to 0 this way, which
 * is what made the suite return a different pass/fail count on every run.
 *
 * Skipping the write when content is byte-identical removes the race entirely
 * for already-applied trees; the temp+rename keeps it atomic when a write is
 * genuinely needed.
 */
import fs from "node:fs";
import path from "node:path";

export function writeSourceIfChanged(fp, content) {
  try {
    if (fs.readFileSync(fp, "utf8") === content) return false;
  } catch {
    /* missing file → fall through and create it */
  }
  const tmp = path.join(
    path.dirname(fp),
    `.${path.basename(fp)}.tmp-${process.pid}-${Math.random().toString(36).slice(2, 8)}`
  );
  fs.writeFileSync(tmp, content);
  fs.renameSync(tmp, fp);
  return true;
}

export default { writeSourceIfChanged };
