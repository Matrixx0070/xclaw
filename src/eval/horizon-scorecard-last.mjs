import fsp from "node:fs/promises";
import path from "node:path";

export function lastScorecardPath(base) {
  return path.resolve(
    base || process.cwd(),
    ".xclaw-evidence",
    "last-scorecard.json"
  );
}

export async function readLastScorecard(opts = {}) {
  const fp = lastScorecardPath(opts.base);
  try {
    const j = JSON.parse(await fsp.readFile(fp, "utf8"));
    const mtime = (await fsp.stat(fp)).mtime.toISOString();
    return { ok: true, path: fp, age: mtime, scorecard: j };
  } catch (e) {
    if (e && e.code === "ENOENT") {
      return { ok: false, path: fp, age: null, scorecard: null };
    }
    throw e;
  }
}

export async function writeLastScorecard(card, opts = {}) {
  const fp = lastScorecardPath(opts.base);
  await fsp.mkdir(path.dirname(fp), { recursive: true });
  await fsp.writeFile(fp, JSON.stringify(card, null, 2) + "\n", "utf8");
  return fp;
}

export default { lastScorecardPath, readLastScorecard, writeLastScorecard };
