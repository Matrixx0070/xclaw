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

/** @returns {Promise<boolean>} true if handled */
export async function tryHandleMediaRoute({ p, method, req, res, json, readBody }) {
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
    json(res, 200, enqueueMediaJob(body));
    return true;
  }

  return false;
}

export default { tryHandleMediaRoute };
