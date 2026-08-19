#!/usr/bin/env node
/**
 * Offline OAuth canary dry-run — exercises reuse detection without live xAI.
 */
import { recordRefreshUse, clearRefreshRegistry, rotationRegistryPath } from "../src/seats/oauth-rotation.mjs";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "xclaw-canary-"));
const cfg = { paths: { configDir: dir } };
clearRefreshRegistry(cfg);

const tok = "canary-refresh-token-demo";
const first = recordRefreshUse(tok, { cfg });
const second = recordRefreshUse(tok, { cfg });

const ok = first.ok === true && second.ok === false && second.reused === true;
console.log(JSON.stringify({
  event: "oauth_canary",
  mode: process.env.XCLAW_OAUTH_CANARY_LIVE === "1" ? "live-requested" : "offline",
  ok,
  first,
  second,
  registry: rotationRegistryPath(cfg),
  at: new Date().toISOString(),
}, null, 2));

if (process.env.XCLAW_OAUTH_CANARY_LIVE === "1") {
  console.error("[oauth-canary] LIVE mode requested — wire credentials and call auth.x.ai (operator)");
}

process.exit(ok ? 0 : 1);
