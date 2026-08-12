/**
 * Cron / doctor log monitoring helpers.
 */
import fs from "node:fs";
import path from "node:path";
import os from "node:os";

export function doctorLogPath(cfg = {}) {
  return (
    cfg.doctor?.cron?.logPath ||
    path.join(os.homedir(), ".xclaw", "doctor-cron.log")
  );
}

export function cronEventsLogPath(cfg = {}) {
  return (
    cfg.cron?.logPath || path.join(os.homedir(), ".xclaw", "cron-events.log")
  );
}

/**
 * Read last N lines of a log file (simple, small-file friendly).
 */
export function tailFile(filePath, { lines = 50, maxBytes = 256_000 } = {}) {
  if (!filePath || !fs.existsSync(filePath)) {
    return {
      path: filePath,
      exists: false,
      lines: [],
      text: "",
    };
  }
  const stat = fs.statSync(filePath);
  const size = stat.size;
  const fd = fs.openSync(filePath, "r");
  try {
    const readSize = Math.min(size, maxBytes);
    const buf = Buffer.alloc(readSize);
    fs.readSync(fd, buf, 0, readSize, size - readSize);
    let text = buf.toString("utf8");
    if (size > maxBytes) text = "…\n" + text;
    const all = text.split(/\r?\n/);
    const slice = all.slice(-Math.max(1, lines));
    return {
      path: filePath,
      exists: true,
      size,
      mtime: stat.mtime.toISOString(),
      lines: slice,
      text: slice.join("\n"),
    };
  } finally {
    fs.closeSync(fd);
  }
}

/**
 * Parse doctor log into run blocks.
 */
export function parseDoctorLogRuns(text) {
  const runs = [];
  const parts = String(text || "").split(/===== doctor /);
  for (const part of parts) {
    if (!part.trim()) continue;
    const header = part.split("\n")[0] || "";
    const m = header.match(
      /^(\S+)\s+ok=(true|false)\s*=====/
    );
    if (!m) continue;
    const body = part.slice(header.length).trim();
    runs.push({
      at: m[1],
      ok: m[2] === "true",
      body,
      failed:
        body.match(/Failed:\s*(.+)/)?.[1]?.split(",").map((s) => s.trim()) ||
        [],
    });
  }
  return runs;
}

export function appendCronEvent(cfg, event) {
  const p = cronEventsLogPath(cfg);
  try {
    fs.mkdirSync(path.dirname(p), { recursive: true });
    const line = JSON.stringify({
      at: new Date().toISOString(),
      ...event,
    });
    fs.appendFileSync(p, line + "\n");
  } catch (err) {
    console.error("[xclaw:cron-log]", err.message);
  }
}

/**
 * Summarize monitoring snapshot.
 */
export function monitorCronLogs(cfg = {}, opts = {}) {
  const lines = opts.lines ?? 40;
  const doctor = tailFile(doctorLogPath(cfg), { lines });
  const events = tailFile(cronEventsLogPath(cfg), { lines });
  const runs = parseDoctorLogRuns(doctor.text);
  const last = runs[runs.length - 1] || null;
  return {
    doctorLog: {
      path: doctor.path,
      exists: doctor.exists,
      size: doctor.size || 0,
      mtime: doctor.mtime || null,
      lastRun: last,
      recentRuns: runs.slice(-10),
      tail: doctor.lines,
    },
    cronEvents: {
      path: events.path,
      exists: events.exists,
      size: events.size || 0,
      mtime: events.mtime || null,
      tail: events.lines,
    },
  };
}

export function formatCronMonitor(snap) {
  const lines = [];
  lines.push("XClaw cron log monitor");
  lines.push("");
  const d = snap.doctorLog;
  lines.push(`Doctor log: ${d.path}`);
  if (!d.exists) {
    lines.push("  (no log yet — wait for first doctor cron tick)");
  } else {
    lines.push(`  size ${d.size} · mtime ${d.mtime}`);
    if (d.lastRun) {
      lines.push(
        `  last run: ${d.lastRun.at} · ok=${d.lastRun.ok}` +
          (d.lastRun.failed?.length
            ? ` · failed: ${d.lastRun.failed.join(", ")}`
            : "")
      );
    }
    lines.push("  --- tail ---");
    for (const line of d.tail.slice(-20)) lines.push("  " + line);
  }
  lines.push("");
  const e = snap.cronEvents;
  lines.push(`Cron events: ${e.path}`);
  if (!e.exists) {
    lines.push("  (no events yet)");
  } else {
    lines.push(`  size ${e.size} · mtime ${e.mtime}`);
    lines.push("  --- tail ---");
    for (const line of e.tail.slice(-15)) lines.push("  " + line);
  }
  return lines.join("\n");
}
