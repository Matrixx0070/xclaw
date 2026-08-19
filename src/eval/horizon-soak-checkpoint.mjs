/**
 * Durable soak checkpoints under .xclaw/soak/{jobId}/
 */
import fsp from "node:fs/promises";
import path from "node:path";

export function soakRoot(base) {
  return path.resolve(base || process.cwd(), ".xclaw", "soak");
}

export function jobDir(jobId, base) {
  const id = String(jobId || "default").replace(/[^a-zA-Z0-9._-]/g, "_");
  return path.join(soakRoot(base), id);
}

export function emptyCheckpoint(jobId) {
  return {
    jobId: String(jobId || "default"),
    turns: 0,
    usedUsd: 0,
    goals: [],
    receipts: [],
    workspace: null,
    updatedAt: new Date().toISOString(),
  };
}

export async function saveSoakCheckpoint(jobId, data = {}, opts = {}) {
  const dir = jobDir(jobId, opts.base);
  await fsp.mkdir(dir, { recursive: true });
  const prev = await loadSoakCheckpoint(jobId, opts).catch(() =>
    emptyCheckpoint(jobId)
  );
  const next = {
    ...prev,
    ...data,
    jobId: String(jobId || prev.jobId || "default"),
    turns: Number(data.turns ?? prev.turns ?? 0),
    usedUsd: Number(data.usedUsd ?? prev.usedUsd ?? 0),
    goals: Array.isArray(data.goals) ? data.goals : prev.goals || [],
    receipts: Array.isArray(data.receipts) ? data.receipts : prev.receipts || [],
    workspace: data.workspace ?? prev.workspace ?? null,
    updatedAt: new Date().toISOString(),
  };
  const fp = path.join(dir, "checkpoint.json");
  const tmp = fp + ".tmp";
  const body = JSON.stringify(next, null, 2) + "\n";
  await fsp.writeFile(tmp, body, "utf8");
  const fh = await fsp.open(tmp, "r+");
  try {
    await fh.sync();
  } finally {
    await fh.close();
  }
  await fsp.rename(tmp, fp);
  return next;
}

export async function loadSoakCheckpoint(jobId, opts = {}) {
  const fp = path.join(jobDir(jobId, opts.base), "checkpoint.json");
  try {
    const raw = await fsp.readFile(fp, "utf8");
    const j = JSON.parse(raw);
    return {
      ...emptyCheckpoint(jobId),
      ...j,
      turns: Number(j.turns || 0),
      usedUsd: Number(j.usedUsd || 0),
    };
  } catch (e) {
    if (e && e.code === "ENOENT") return emptyCheckpoint(jobId);
    throw e;
  }
}

export async function listSoakJobs(opts = {}) {
  const root = soakRoot(opts.base);
  try {
    const ents = await fsp.readdir(root, { withFileTypes: true });
    const jobs = [];
    for (const e of ents) {
      if (!e.isDirectory()) continue;
      const cp = await loadSoakCheckpoint(e.name, opts);
      jobs.push({
        jobId: e.name,
        turns: cp.turns,
        usedUsd: cp.usedUsd,
        updatedAt: cp.updatedAt,
      });
    }
    return jobs.sort((a, b) =>
      String(b.updatedAt).localeCompare(String(a.updatedAt))
    );
  } catch (e) {
    if (e && e.code === "ENOENT") return [];
    throw e;
  }
}

export default {
  soakRoot,
  jobDir,
  emptyCheckpoint,
  saveSoakCheckpoint,
  loadSoakCheckpoint,
  listSoakJobs,
};
