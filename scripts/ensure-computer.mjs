#!/usr/bin/env node
/**
 * Ensure the computer server is listening (lab).
 * Usage: node scripts/ensure-computer.mjs
 *
 * A6: thin-server merge — this used to insist /health reported a "thin" engine
 * and spawned src/computer/thin-server.mjs. There is one engine now, so it
 * accepts whichever xclaw computer server already holds the port and
 * otherwise starts the bundle.
 *
 * "Whichever" still has to BE one. Dropping the engine check entirely left
 * only "200 + parses as JSON", so any unrelated local service on 4243 was
 * adopted as the computer server: this script exited 0, the real server never
 * started, and every later tool call went to a stranger. The check is now on
 * the payload SHAPE (engine + tools), which both the bundle and the retired
 * thin server emit, rather than on a specific engine name.
 */
import { spawn } from "node:child_process";
import http from "node:http";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");
const host = process.env.XCLAW_COMPUTER_HOST || "127.0.0.1";
const port = Number(process.env.XCLAW_COMPUTER_PORT || 4243);

/**
 * An xclaw computer server identifies itself by reporting an engine name and
 * its tool list. Version-agnostic on purpose — a rolling upgrade must not
 * make the two sides refuse to recognise each other.
 */
export function isComputerServerHealth(body) {
  return (
    Boolean(body) &&
    typeof body === "object" &&
    typeof body.engine === "string" &&
    body.engine.length > 0 &&
    Array.isArray(body.tools)
  );
}

function health() {
  return new Promise((resolve) => {
    const req = http.get({ host, port, path: "/health", timeout: 1500 }, (res) => {
      let d = "";
      res.on("data", (c) => (d += c));
      res.on("end", () => {
        try {
          const body = JSON.parse(d);
          resolve({
            ok: res.statusCode === 200 && isComputerServerHealth(body),
            body,
            foreign: res.statusCode === 200 && !isComputerServerHealth(body),
          });
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

async function main() {
  const h0 = await health();
  if (h0.ok) {
    console.log(JSON.stringify({ already: true, ...h0.body }, null, 2));
    process.exit(0);
  }
  if (h0.foreign) {
    // Naming the occupant beats the generic "did not become healthy" the
    // spawn below would produce once it fails to bind.
    console.error(
      JSON.stringify(
        { ok: false, error: "port held by a service that is not an xclaw computer server", port },
        null,
        2
      )
    );
    process.exit(1);
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
    console.error(
      JSON.stringify({ ok: false, error: "computer server did not become healthy", port }, null, 2)
    );
    process.exit(1);
  }
  console.log(JSON.stringify({ started: true, pid: child.pid, ...last.body }, null, 2));
}

// Importable for isComputerServerHealth without probing or spawning anything.
if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) {
  await main();
}
