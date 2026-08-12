import http from "http";
import { loadConfig } from "../config/load.mjs";
import { getComputerStatus, computerProbeHost } from "../computer/manager.mjs";

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

export async function printStatus() {
  const cfg = await loadConfig();
  const gwUrl = `http://${cfg.gateway.host}:${cfg.gateway.port}`;
  const compUrl = `http://${computerProbeHost(cfg)}:${cfg.computer.port}`;

  console.log("XClaw Status");
  console.log("============");
  console.log(`Config:   ${cfg.paths.configFile}`);
  console.log(`Gateway:  ${gwUrl}`);
  console.log(`Computer: ${compUrl}`);
  console.log("");

  const gw = await getJson(`${gwUrl}/health`);
  if (gw.ok && gw.body?.status === "healthy") {
    console.log(`Gateway:  UP  (${gw.body.service} v${gw.body.version} phase ${gw.body.phase})`);
    console.log(`          computer reported: ${gw.body.computer}`);
  } else {
    console.log(`Gateway:  DOWN  (${gw.error || gw.status || "unreachable"})`);
  }

  const cst = await getComputerStatus(cfg);
  if (cst.healthy) {
    console.log(`Computer: UP  pid=${cst.pid ?? "?"}  ${cst.health?.body ? JSON.stringify(cst.health.body) : ""}`);
    console.log(`          log ${cst.logPath}`);
  } else {
    console.log(`Computer: DOWN  (${cst.health?.error || "unreachable"})`);
    console.log(`          pid=${cst.pid ?? "—"} alive=${cst.pidAlive} log=${cst.logPath}`);
  }

  const ch = await getJson(`${gwUrl}/channels/status`);
  if (ch.ok && ch.body) {
    console.log("");
    console.log("Channels:");
    console.log(`  webchat:  ${ch.body.webchat?.enabled ? "enabled" : "disabled"}`);
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
}
