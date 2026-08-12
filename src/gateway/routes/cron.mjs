/**
 * Gateway cron HTTP routes (extracted from index.mjs).
 *
 * Paths:
 *   GET    /cron/logs · /cron/logs/doctor · /cron/status · /cron/jobs · /cron/jobs/:id
 *   POST   /cron/jobs · /cron/jobs/:id/run
 *   DELETE /cron/jobs/:id
 *
 * The /cron/eval routes stay in index.mjs (eval-job concern, not the scheduler).
 */
import {
  addJob,
  cancelJob,
  listJobs,
  run as runCronJob,
  status as cronStatus,
  getJob,
} from "../../cron/scheduler.mjs";

/**
 * @param {object} args
 * @returns {Promise<boolean>} true if handled
 */
export async function tryHandleCronRoute({ p, method, req, res, url, cfg, json, readBody }) {
  if (p === "/cron/logs" && method === "GET") {
    const { monitorCronLogs } = await import("../../cron/logs.mjs");
    const lines = Number(url.searchParams.get("lines") || 40);
    json(res, 200, monitorCronLogs(cfg, { lines }));
    return true;
  }
  if (p === "/cron/logs/doctor" && method === "GET") {
    const { tailFile, doctorLogPath, parseDoctorLogRuns } = await import("../../cron/logs.mjs");
    const lines = Number(url.searchParams.get("lines") || 80);
    const tail = tailFile(doctorLogPath(cfg), { lines });
    json(res, 200, { ...tail, runs: parseDoctorLogRuns(tail.text) });
    return true;
  }
  if (p === "/cron/status" && method === "GET") {
    json(res, 200, cronStatus());
    return true;
  }
  if (p === "/cron/jobs" && method === "GET") {
    json(res, 200, { jobs: listJobs() });
    return true;
  }
  if (p === "/cron/jobs" && method === "POST") {
    const body = await readBody(req);
    const job = addJob({
      name: body.name || "job",
      intervalMs: body.intervalMs,
      schedule: body.schedule,
      enabled: body.enabled !== false,
      sessionKey: body.sessionKey,
      sessionTarget: body.sessionTarget,
      delivery: body.delivery,
      deliveryContext: body.deliveryContext,
      payload: body.payload,
      agentId: body.agentId,
      cfg,
      handler: body.payload?.message || body.payload?.text
        ? undefined // use announceCronJob default
        : async (job) => {
            console.log(`[xclaw:cron] tick ${job.name}`, job.delivery || "");
          },
    });
    json(res, 200, { id: job.id, job: { ...job, handler: undefined } });
    return true;
  }
  if (p.startsWith("/cron/jobs/") && p.endsWith("/run") && method === "POST") {
    const id = p.slice("/cron/jobs/".length, -"/run".length);
    json(res, 200, await runCronJob(id));
    return true;
  }
  if (p.startsWith("/cron/jobs/") && method === "GET") {
    const id = p.slice("/cron/jobs/".length);
    const job = getJob(id);
    if (job) json(res, 200, { ...job, handler: undefined });
    else json(res, 404, { error: "not found" });
    return true;
  }
  if (p.startsWith("/cron/jobs/") && method === "DELETE") {
    cancelJob(p.slice("/cron/jobs/".length));
    json(res, 200, { ok: true });
    return true;
  }

  return false;
}

export default { tryHandleCronRoute };
