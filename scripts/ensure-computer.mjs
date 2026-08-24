#!/usr/bin/env node
/**
 * Ensure the computer server is listening (lab).
 * Usage: node scripts/ensure-computer.mjs
 *
 * A6: thin-server merge — this used to insist /health reported a "thin" engine
 * and spawned src/computer/thin-server.mjs. There is one engine now, so it
 * accepts whatever healthy server already holds the port and otherwise starts
 * the bundle.
 */
import { spawn } from "node:child_process";
import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");
const host = process.env.XCLAW_COMPUTER_HOST || "127.0.0.1";
const port = Number(process.env.XCLAW_COMPUTER_PORT || 4243);

function health() {
  return new Promise((resolve) => {
    const req = http.get({ host, port, path: "/health", timeout: 1500 }, (res) => {
      let d = "";
      res.on("data", (c) => (d += c));
      res.on("end", () => {
        try {
          resolve({ ok: res.statusCode === 200, body: JSON.parse(d) });
        } catch {
          resolve({ ok: false, body: d });
        }
      });
    });
    req.on("error", () => resolve({ ok: false }));
    req.on("timeout", () => {
      req.destroy();
      resolve({ ok: false });
    });
  });
}

const h0 = await health();
if (h0.ok) {
  console.log(JSON.stringify({ already: true, ...h0.body }, null, 2));
  process.exit(0);
}

const child = spawn(process.execPath, [path.join(root, "src/computer/xclaw-server.mjs")], {
  cwd: root,
  env: { ...process.env, PORT: String(port) },
  detached: true,
  stdio: "ignore",
});
child.unref();

let last = null;
for (let i = 0; i < 40; i++) {
  await new Promise((r) => setTimeout(r, 250));
  last = await health();
  if (last.ok) break;
}

if (!last?.ok) {
  console.error(JSON.stringify({ ok: false, error: "computer server did not become healthy", port }, null, 2));
  process.exit(1);
}
console.log(JSON.stringify({ started: true, pid: child.pid, ...last.body }, null, 2));
