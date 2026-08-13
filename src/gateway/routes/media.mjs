/**
 * Gateway media/canvas HTTP routes (split from routes/api.mjs).
 *
 * Paths:
 *   GET|POST /media/canvas · GET /media/canvas/:id · GET /media/providers
 *   GET|POST /media/jobs · GET /media/jobs/:id
 */
import {
  createCanvas,
  getCanvas,
  enqueueMediaJob,
  listMediaJobs,
  listCanvases,
  listImageProviders,
  getMediaJob,
} from "../../media/canvas.mjs";

/**
 * Per-provider image keys from the credential store (same store as chat —
 * `xclaw providers` / the Providers UI). Without this the HTTP route only saw
 * env vars, so a UI-configured xai/openai key couldn't generate images while
 * the agent's image tool (which resolves the store) could.
 */
async function resolveImageApiKeys(cfg) {
  const keys = {};
  try {
    const { resolveProviderToken } = await import("../../auth/profiles.mjs");
    for (const prov of listImageProviders()) {
      try {
        const tok = await resolveProviderToken(cfg || {}, prov.id, {});
        if (tok?.token) keys[prov.id] = tok.token;
      } catch { /* provider without stored credential */ }
    }
  } catch { /* profile store unavailable — env fallback still applies */ }
  return keys;
}

/** @returns {Promise<boolean>} true if handled */
export async function tryHandleMediaRoute({ p, method, req, res, cfg, json, readBody }) {
  if (p === "/media/canvas" && method === "POST") {
    const body = await readBody(req).catch(() => ({}));
    json(res, 200, createCanvas(body));
    return true;
  }
  if (p.startsWith("/media/canvas/") && method === "GET") {
    const c = getCanvas(p.slice("/media/canvas/".length));
    if (c) json(res, 200, c);
    else json(res, 404, { error: "not found" });
    return true;
  }
  if (p === "/media/providers" && method === "GET") {
    json(res, 200, { providers: listImageProviders() });
    return true;
  }
  if (p === "/media/canvas" && method === "GET") {
    json(res, 200, { canvases: listCanvases() });
    return true;
  }
  if (p === "/media/jobs" && method === "GET") {
    json(res, 200, { jobs: listMediaJobs() });
    return true;
  }
  if (p.startsWith("/media/jobs/") && method === "GET") {
    const job = getMediaJob(p.slice("/media/jobs/".length));
    if (job) json(res, 200, job);
    else json(res, 404, { error: "not found" });
    return true;
  }
  if (p === "/media/jobs" && method === "POST") {
    const body = await readBody(req);
    // enqueueMediaJob is async — without the await this serialized a pending
    // Promise, so every caller got literally "{}" back (found by clicking
    // Generate in the control UI; the job ran but the response was empty).
    const apiKeys = body.apiKey ? {} : await resolveImageApiKeys(cfg);
    json(res, 200, await enqueueMediaJob({ ...body, apiKeys }));
    return true;
  }

  return false;
}

export default { tryHandleMediaRoute };
