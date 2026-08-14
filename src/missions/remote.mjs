/**
 * Remote mission workers — dispatch missions to OTHER xclaw gateways.
 *
 * A worker is any reachable xclaw gateway with missions enabled:
 *   cfg.missions.workers: [{ name, url, token, allowInsecure? }]
 *
 * The coordinator proxies start/status/diff/merge/rollback over the worker's
 * own token-gated mission API — the worker's evidence gate and approval
 * story apply unchanged on its host. `repoDir` is a path ON THE WORKER.
 *
 * URL policy mirrors provider base-urls: https anywhere; plain http only to
 * loopback unless the worker entry sets allowInsecure (LAN labs).
 */

const LOOPBACK_RE = /^(127\.\d+\.\d+\.\d+|localhost|\[::1\]|::1)$/i;

export function validateWorkerUrl(raw, { allowInsecure = false } = {}) {
  let u;
  try {
    u = new URL(String(raw || ""));
  } catch {
    return { ok: false, error: "invalid worker url" };
  }
  if (u.protocol === "https:") return { ok: true, url: u };
  if (u.protocol === "http:") {
    if (LOOPBACK_RE.test(u.hostname) || allowInsecure) return { ok: true, url: u };
    return { ok: false, error: "http worker urls must be loopback (set allowInsecure for trusted LANs)" };
  }
  return { ok: false, error: `unsupported protocol ${u.protocol}` };
}

export function listWorkers(cfg = {}) {
  const raw = Array.isArray(cfg.missions?.workers) ? cfg.missions.workers : [];
  return raw
    .filter((w) => w && w.name && w.url)
    .map((w) => ({
      name: String(w.name),
      url: String(w.url),
      hasToken: Boolean(w.token),
      allowInsecure: w.allowInsecure === true,
    }));
}

export function findWorker(cfg, name) {
  const raw = Array.isArray(cfg.missions?.workers) ? cfg.missions.workers : [];
  return raw.find((w) => w && w.name === String(name)) || null;
}

async function workerFetch(worker, path, { method = "GET", body, timeoutMs = 20_000 } = {}) {
  const v = validateWorkerUrl(worker.url, { allowInsecure: worker.allowInsecure === true });
  if (!v.ok) throw new Error(v.error);
  const url = new URL(path, v.url.href.endsWith("/") ? v.url.href : v.url.href + "/");
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      method,
      signal: ac.signal,
      headers: {
        ...(worker.token ? { "x-xclaw-token": worker.token } : {}),
        ...(body !== undefined ? { "content-type": "application/json" } : {}),
      },
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    });
    const text = await res.text();
    let data;
    try {
      data = JSON.parse(text);
    } catch {
      data = { raw: text.slice(0, 500) };
    }
    if (!res.ok) {
      const msg = data?.error || `worker HTTP ${res.status}`;
      throw new Error(`${worker.name}: ${msg}`);
    }
    return data;
  } finally {
    clearTimeout(timer);
  }
}

export async function startRemoteMission(worker, { goal, repoDir, strategy, tasks, verify, maxAttempts } = {}) {
  return workerFetch(worker, "missions", {
    method: "POST",
    body: {
      goal,
      repoDir,
      ...(strategy ? { strategy } : {}),
      ...(Array.isArray(tasks) ? { tasks } : {}),
      ...(Array.isArray(verify) ? { verify } : {}),
      ...(maxAttempts ? { maxAttempts } : {}),
    },
    timeoutMs: 30_000,
  });
}

export async function listRemoteMissions(worker, { limit = 25 } = {}) {
  return workerFetch(worker, `missions?limit=${Number(limit)}`);
}

export async function getRemoteMission(worker, id) {
  return workerFetch(worker, `missions/${encodeURIComponent(id)}`);
}

export async function getRemoteMissionDiff(worker, id) {
  return workerFetch(worker, `missions/${encodeURIComponent(id)}/diff`, { timeoutMs: 30_000 });
}

export async function mergeRemoteMission(worker, id, { checkOnly = false } = {}) {
  return workerFetch(worker, `missions/${encodeURIComponent(id)}/merge`, {
    method: "POST",
    body: { checkOnly },
    timeoutMs: 60_000,
  });
}

export async function rollbackRemoteMission(worker, id) {
  return workerFetch(worker, `missions/${encodeURIComponent(id)}/rollback`, {
    method: "POST",
    body: {},
    timeoutMs: 30_000,
  });
}

/** Reachability + version probe (worker /gateway/info is sanitized + open). */
export async function pingWorker(worker) {
  try {
    const info = await workerFetch(worker, "gateway/info", { timeoutMs: 6_000 });
    return { ok: true, name: worker.name, version: info.version || null, computerHealthy: info.computer?.healthy ?? null };
  } catch (e) {
    return { ok: false, name: worker.name, error: e.message };
  }
}
