/**
 * xclaw status — gateway + computer + active agent sessions
 */
import http from "http";
import { loadConfig } from "../config/load.mjs";
import { getComputerStatus, computerBaseUrl } from "../computer/manager.mjs";
import { listActiveSessions } from "../agent/session-control.mjs";

function getJson(url) {
  return new Promise((resolve) => {
    const req = http.get(url, (res) => {
      let body = "";
      res.on("data", (c) => (body += c));
      res.on("end", () => {
        try {
          resolve({ ok: true, status: res.statusCode, body: JSON.parse(body) });
        } catch {
          resolve({ ok: false, status: res.statusCode, body });
        }
      });
    });
    req.on("error", (e) => resolve({ ok: false, error: e.message }));
    req.setTimeout(2000, () => {
      req.destroy();
      resolve({ ok: false, error: "timeout" });
    });
  });
}

/**
 * @param {object} [opts]
 * @param {boolean} [opts.json]
 * @param {string} [opts.root]
 */
export async function printStatus(opts = {}) {
  const json = Boolean(opts.json);
  const cfg = await loadConfig();
  const gwUrl = `http://${cfg.gateway.host}:${cfg.gateway.port}`;
  const compUrl = computerBaseUrl(cfg);

  const gw = await getJson(`${gwUrl}/health`);
  const cst = await getComputerStatus(cfg);
  const ch = await getJson(`${gwUrl}/channels/status`);
  let sessions = [];
  try {
    sessions = listActiveSessions();
  } catch {
    sessions = [];
  }

  let autonomy = null;
  try {
    const { autonomyPolicySummary } = await import("../config/autonomy-policy.mjs");
    autonomy = autonomyPolicySummary(cfg);
  } catch {
    autonomy = null;
  }
  const fabric = {
    commitGates:
      process.env.XCLAW_COMMIT_GATES === "1" ||
      process.env.XCLAW_COMMIT_GATES === "true",
    fabricEnforce:
      process.env.XCLAW_FABRIC_ENFORCE === "1" ||
      process.env.XCLAW_FABRIC_ENFORCE === "true",
    prodHardening: cfg._prodHardening || [],
  };

  const report = {
    ok: Boolean(gw.ok && gw.body?.status === "healthy"),
    profile: cfg.profile || process.env.XCLAW_PROFILE || "lab",
    configPath: cfg.paths?.configFile || null,
    autonomy,
    fabric,
    gateway: {
      url: gwUrl,
      up: Boolean(gw.ok && gw.body?.status === "healthy"),
      health: gw.ok ? gw.body : { error: gw.error || gw.status },
    },
    computer: {
      url: compUrl,
      up: Boolean(cst.healthy),
      pid: cst.pid ?? null,
      pidAlive: cst.pidAlive,
      logPath: cst.logPath,
      health: cst.health || null,
    },
    sessions: {
      active: sessions.length,
      items: sessions,
    },
    channels: ch.ok ? ch.body : null,
    at: new Date().toISOString(),
  };

  if (json) {
    console.log(JSON.stringify(report, null, 2));
    return report;
  }

  console.log("XClaw Status");
  console.log("============");
  console.log(`Profile:  ${report.profile}`);
  console.log(`Config:   ${report.configPath || "—"}`);
  if (report.autonomy) {
    const a = report.autonomy;
    console.log(
      `Autonomy: level=${a.level} autoApprove=${a.autoApprove} policy=${a.approvalPolicy} maxTurns=${a.maxTurns} heartbeat=${a.heartbeatEnabled}`
    );
  }
  console.log(
    `Fabric:   commitGates=${report.fabric.commitGates} fabricEnforce=${report.fabric.fabricEnforce}` +
      (report.fabric.prodHardening?.length
        ? ` hardening=${report.fabric.prodHardening.length}`
        : "")
  );
  console.log(`Gateway:  ${gwUrl}`);
  console.log(`Computer: ${compUrl}`);
  console.log("");

  if (report.gateway.up) {
    const b = report.gateway.health;
    console.log(
      `Gateway:  UP  (${b.service || "xclaw"} v${b.version || "?"} phase ${b.phase || "?"})`
    );
    if (b.computer != null) console.log(`          computer reported: ${b.computer}`);
  } else {
    console.log(
      `Gateway:  DOWN  (${report.gateway.health?.error || "unreachable"})`
    );
  }

  if (report.computer.up) {
    console.log(
      `Computer: UP  pid=${report.computer.pid ?? "?"}  ${
        report.computer.health?.body
          ? JSON.stringify(report.computer.health.body)
          : ""
      }`
    );
    console.log(`          log ${report.computer.logPath}`);
  } else {
    console.log(
      `Computer: DOWN  (${report.computer.health?.error || "unreachable"})`
    );
    console.log(
      `          pid=${report.computer.pid ?? "—"} alive=${report.computer.pidAlive} log=${report.computer.logPath}`
    );
  }

  console.log("");
  console.log(
    `Sessions: ${report.sessions.active} active  (xclaw sessions-active · xclaw stop-all)`
  );
  for (const s of sessions.slice(0, 8)) {
    console.log(
      `  · ${s.sessionId}  aborted=${s.aborted}  ${s.label || ""}`.trim()
    );
  }
  if (sessions.length > 8) console.log(`  · … +${sessions.length - 8} more`);

  if (ch.ok && ch.body) {
    console.log("");
    console.log("Channels:");
    console.log(
      `  webchat:  ${ch.body.webchat?.enabled ? "enabled" : "disabled"}`
    );
    for (const m of ch.body.messaging || []) {
      const bits = [
        m.enabled ? "enabled" : "disabled",
        m.username && `@${m.username}`,
        m.connected === true && "connected",
        m.connected === false && m.enabled && "connecting/offline",
      ].filter(Boolean);
      console.log(`  ${m.name}: ${bits.join(" · ")}`);
    }
  }

  return report;
}

export default { printStatus };
