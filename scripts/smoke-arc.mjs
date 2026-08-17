#!/usr/bin/env node
/**
 * Offline smoke for the autonomy/fabric/ops arc (no API key).
 * Exit nonzero if any suite fails.
 */
import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const packs = [
  "test/autonomy-policy.test.mjs",
  "test/prod-hardening.test.mjs",
  "test/skill-install-gate.test.mjs",
  "test/heartbeat-delivery.test.mjs",
  "test/host-workspace.test.mjs",
  "test/browser-profile-default.test.mjs",
  "test/browser-observe-hybrid.test.mjs",
  "test/long-horizon-fixtures.test.mjs",
  "test/telegram-prod-policy.test.mjs",
  "test/telegram-callback-auth.test.mjs",
  "test/agent-run-store.test.mjs",
  "test/browser-mark-click.test.mjs",
  "test/approvals-inbox.test.mjs",
  "test/cost-governor.test.mjs",
  "test/long-harness.test.mjs",
  "test/bounded-queue.test.mjs",
  "test/sandbox-tmp-allow.test.mjs",
];

function run(args) {
  return new Promise((resolve) => {
    const c = spawn(process.execPath, args, { cwd: root, stdio: "inherit" });
    c.on("exit", (code) => resolve(code ?? 1));
  });
}

const code = await run(["--test", ...packs]);
if (code !== 0) process.exit(code);

const st = await run([path.join(root, "bin/xclaw.mjs"), "self-test"]);
process.exit(st);
