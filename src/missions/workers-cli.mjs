/**
 * Worker federation CLI core — shared by `xclaw workers` and tests.
 *
 * Coordinator side: add / remove / list / ping configured workers.
 * Worker side: token bootstrap + the exact join command to paste on the
 * coordinator. All config writes go through saveConfigPatch (user config,
 * chmod 600 by init).
 */
import crypto from "node:crypto";
import { listWorkers, findWorker, pingWorker, validateWorkerUrl } from "./remote.mjs";

export async function addWorkerEntry(cfg, { name, url, token, allowInsecure = false }) {
  const n = String(name || "").trim();
  if (!n || !/^[\w.-]{1,40}$/.test(n)) {
    return { ok: false, error: "worker name required ([\\w.-], ≤40 chars)" };
  }
  const v = validateWorkerUrl(url, { allowInsecure });
  if (!v.ok) return { ok: false, error: v.error };
  const { saveConfigPatch } = await import("../config/load.mjs");
  const existing = Array.isArray(cfg.missions?.workers) ? cfg.missions.workers : [];
  const next = existing.filter((w) => w?.name !== n);
  next.push({
    name: n,
    url: String(url),
    ...(token ? { token: String(token) } : {}),
    ...(allowInsecure ? { allowInsecure: true } : {}),
  });
  await saveConfigPatch({ missions: { ...(cfg.missions || {}), workers: next } });
  cfg.missions = { ...(cfg.missions || {}), workers: next };
  return { ok: true, workers: listWorkers(cfg) };
}

export async function removeWorkerEntry(cfg, name) {
  const { saveConfigPatch } = await import("../config/load.mjs");
  const existing = Array.isArray(cfg.missions?.workers) ? cfg.missions.workers : [];
  const next = existing.filter((w) => w?.name !== String(name));
  const removed = next.length !== existing.length;
  await saveConfigPatch({ missions: { ...(cfg.missions || {}), workers: next } });
  cfg.missions = { ...(cfg.missions || {}), workers: next };
  return { ok: true, removed, workers: listWorkers(cfg) };
}

export async function pingAllWorkers(cfg) {
  const raw = Array.isArray(cfg.missions?.workers) ? cfg.missions.workers : [];
  return Promise.all(raw.filter((w) => w?.name && w?.url).map((w) => pingWorker(w)));
}

/**
 * Worker-side bootstrap: make sure this gateway has an operator token
 * (generate + persist when missing) and return it.
 */
export async function ensureGatewayToken(cfg) {
  const existing = cfg.gateway?.token;
  if (existing) return { ok: true, token: existing, generated: false };
  const token = `xclaw_${crypto.randomBytes(24).toString("base64url")}`;
  const { saveConfigPatch } = await import("../config/load.mjs");
  await saveConfigPatch({ gateway: { ...(cfg.gateway || {}), token } });
  cfg.gateway = { ...(cfg.gateway || {}), token };
  return { ok: true, token, generated: true };
}

/**
 * The exact command to run on the COORDINATOR to join this worker.
 * `publicUrl` should be the TLS endpoint when federating beyond loopback
 * (see docs/FEDERATION.md); defaults to the local loopback address.
 */
export async function buildJoinCommand(cfg, { name, publicUrl } = {}) {
  const t = await ensureGatewayToken(cfg);
  const host = cfg.gateway?.host || "127.0.0.1";
  const port = cfg.gateway?.port || 18790;
  const url = publicUrl || `http://${host}:${port}`;
  const workerName = name || (await import("node:os")).default.hostname().replace(/[^\w.-]/g, "-").slice(0, 40);
  const insecure = url.startsWith("http://") && !/^http:\/\/(127\.|localhost|\[::1\])/.test(url);
  return {
    ok: true,
    tokenGenerated: t.generated,
    command:
      `xclaw workers add ${workerName} ${url} --token ${t.token}` +
      (insecure ? " --allow-insecure" : ""),
    note: insecure
      ? "plain http beyond loopback — put TLS in front (docs/FEDERATION.md) instead of shipping --allow-insecure to prod"
      : null,
  };
}

export { listWorkers, findWorker };
