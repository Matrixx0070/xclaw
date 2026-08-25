/**
 * Env bind overrides must actually override (src/config/load.mjs).
 *
 * Second finding of the same class as the bind guard, and a wider one: the
 * four variables below were documented in 3.76.0 ("Env bind overrides
 * (XCLAW_GATEWAY_HOST/PORT, XCLAW_COMPUTER_HOST/PORT …) so compose-published
 * ports work", CHANGELOG.md:3284 and INSTALL.md), and they are set by
 * deploy/Dockerfile:21, deploy/docker-compose.yml and
 * deploy/docker-compose.sidecar.yml — with an explanatory comment, no less.
 * No code in src/ ever read them. Proven before the fix: with
 * XCLAW_GATEWAY_HOST=0.0.0.0 and XCLAW_GATEWAY_PORT=19999 exported,
 * loadConfig() returned 127.0.0.1:18790.
 *
 * The consequence was worse than "the setting does nothing". A container bound
 * loopback inside its own network namespace, so `-p 18790:18790` published a
 * dead port — while the image's own HEALTHCHECK
 * (`curl -fsS http://127.0.0.1:18790/ready`, run INSIDE the container) hit that
 * loopback listener and reported healthy. Docker said healthy; nothing outside
 * could connect.
 *
 * Both directions, one field apart: every case here has a mirror that changes
 * only the env var, so a loadConfig that always returned the env value — or
 * always ignored it — fails one of the pair.
 */
import { describe, it, before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), "xclaw-envbind-"));
const saved = {};
const ENV_KEYS = [
  "HOME",
  "XCLAW_GATEWAY_HOST",
  "XCLAW_GATEWAY_PORT",
  "XCLAW_COMPUTER_HOST",
  "XCLAW_COMPUTER_PORT",
  "XCLAW_COMPUTER_URL",
  "XCLAW_PROFILE",
  "XCLAW_GATEWAY_TOKEN",
];

/** What the config FILE says, so an env win is visibly a win over something. */
const FILE_GATEWAY = { host: "127.0.0.1", port: 18790 };
const FILE_COMPUTER = { host: "127.0.0.1", port: 4243 };

let loadConfig;
let warnings;
let restoreConsole;

before(async () => {
  for (const k of ENV_KEYS) saved[k] = process.env[k];

  const home = fs.mkdtempSync(path.join(tmpRoot, "home-"));
  fs.mkdirSync(path.join(home, ".xclaw"), { recursive: true });
  fs.writeFileSync(
    path.join(home, ".xclaw", "xclaw.json"),
    JSON.stringify({
      profile: "lab",
      gateway: { ...FILE_GATEWAY },
      computer: { ...FILE_COMPUTER, autoStart: false },
      channels: { telegram: { enabled: false }, webchat: { enabled: false } },
    })
  );
  process.env.HOME = home;

  const warn = console.warn;
  const log = console.log;
  warnings = [];
  console.warn = (...a) => warnings.push(a.join(" "));
  console.log = () => {};
  restoreConsole = () => {
    console.warn = warn;
    console.log = log;
  };

  ({ loadConfig } = await import("../src/config/load.mjs"));
});

beforeEach(() => {
  warnings.length = 0;
  for (const k of ENV_KEYS.slice(1)) delete process.env[k];
});

after(() => {
  if (restoreConsole) restoreConsole();
  for (const [k, v] of Object.entries(saved)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
  fs.rmSync(tmpRoot, { recursive: true, force: true });
});

describe("env bind overrides beat file config", () => {
  it("uses the file's gateway bind when no env is set", async () => {
    // The mirror for every gateway case below: without it, a loadConfig that
    // hard-coded 0.0.0.0 would pass them all.
    const cfg = await loadConfig();

    assert.equal(cfg.gateway.host, FILE_GATEWAY.host);
    assert.equal(cfg.gateway.port, FILE_GATEWAY.port);
  });

  it("honours XCLAW_GATEWAY_HOST and XCLAW_GATEWAY_PORT", async () => {
    process.env.XCLAW_GATEWAY_HOST = "0.0.0.0";
    process.env.XCLAW_GATEWAY_PORT = "19999";

    const cfg = await loadConfig();

    assert.equal(cfg.gateway.host, "0.0.0.0", "the compose/Dockerfile host must win");
    assert.equal(cfg.gateway.port, 19999);
  });

  it("uses the file's computer bind when no env is set", async () => {
    const cfg = await loadConfig();

    assert.equal(cfg.computer.host, FILE_COMPUTER.host);
    assert.equal(cfg.computer.port, FILE_COMPUTER.port);
  });

  it("honours XCLAW_COMPUTER_HOST and XCLAW_COMPUTER_PORT", async () => {
    // src/computer/manager.mjs builds the child's env from cfg.computer, so
    // the subprocess only ever sees these values by way of the config.
    process.env.XCLAW_COMPUTER_HOST = "0.0.0.0";
    process.env.XCLAW_COMPUTER_PORT = "4444";

    const cfg = await loadConfig();

    assert.equal(cfg.computer.host, "0.0.0.0");
    assert.equal(cfg.computer.port, 4444);
  });

  it("overrides one axis without disturbing the other", async () => {
    // Setting only the host must not reset the port to a default: this is the
    // sidecar compose's exact shape (host from env, port from config).
    process.env.XCLAW_GATEWAY_HOST = "0.0.0.0";

    const cfg = await loadConfig();

    assert.equal(cfg.gateway.host, "0.0.0.0");
    assert.equal(cfg.gateway.port, FILE_GATEWAY.port, "an untouched axis keeps its config value");
  });

  it("reports an unusable port instead of dropping it silently", async () => {
    // Silent-drop is the whole failure being fixed here, so a bad value has to
    // say so. The host on the same line still applies.
    process.env.XCLAW_GATEWAY_HOST = "0.0.0.0";
    process.env.XCLAW_GATEWAY_PORT = "not-a-port";

    const cfg = await loadConfig();

    assert.equal(cfg.gateway.port, FILE_GATEWAY.port, "an unusable port falls back to config");
    assert.equal(cfg.gateway.host, "0.0.0.0", "the valid half of the pair still applies");
    assert.ok(
      warnings.some((w) => /ignoring XCLAW_GATEWAY_PORT=not-a-port/.test(w)),
      `the operator must be told (saw: ${JSON.stringify(warnings)})`
    );
  });

  it("rejects a port outside 1–65535", async () => {
    process.env.XCLAW_GATEWAY_PORT = "70000";

    const cfg = await loadConfig();

    assert.equal(cfg.gateway.port, FILE_GATEWAY.port);
    assert.ok(warnings.some((w) => /ignoring XCLAW_GATEWAY_PORT=70000/.test(w)));
  });
});
