import test from "node:test";
import assert from "node:assert/strict";
import { normalizeBashTimeoutSeconds } from "../src/computer/modules/bash-tool.mjs";
import { sanitizeToolArgs } from "../src/agent/computer-client.mjs";

test("normalizeBashTimeoutSeconds defaults", () => {
  assert.equal(normalizeBashTimeoutSeconds(undefined), 30);
  assert.equal(normalizeBashTimeoutSeconds(null), 30);
  assert.equal(normalizeBashTimeoutSeconds("bad"), 30);
});

test("normalizeBashTimeoutSeconds seconds under max", () => {
  assert.equal(normalizeBashTimeoutSeconds(30), 30);
  assert.equal(normalizeBashTimeoutSeconds(120), 120);
  assert.equal(normalizeBashTimeoutSeconds(180), 120);
});

test("normalizeBashTimeoutSeconds milliseconds heuristic", () => {
  assert.equal(normalizeBashTimeoutSeconds(30_000), 30);
  assert.equal(normalizeBashTimeoutSeconds(120_000), 120);
  assert.equal(normalizeBashTimeoutSeconds(300_000), 120);
});

test("sanitizeToolArgs clamps bash timeout", () => {
  const a = sanitizeToolArgs("xclaw_bash", { command: "true", timeout: 120000 });
  assert.equal(a.timeout, 120);
  const b = sanitizeToolArgs("xclaw_bash", { command: "true", timeout: 45 });
  assert.equal(b.timeout, 45);
  const c = sanitizeToolArgs("xclaw_file_write", { path: "/x", content: "y", timeout: 99999 });
  assert.equal(c.timeout, 99999); // untouched
});

// Sweep #69: every case above lands exactly AT 120 after the ms→s divide, so
// removing the 120 ceiling left the full suite green — a model-passed
// timeout of 300s (or 300000ms) would hang a computer session for minutes
// unclamped at this client-side seam. The server-side sibling
// (normalizeBashTimeoutSeconds) is ceiling-covered; this pins the sanitize
// consumer independently (defense in depth — coverage does not transfer).
test("sanitizeToolArgs ceiling fires ALONE (not just at the ms boundary)", () => {
  assert.equal(sanitizeToolArgs("xclaw_bash", { timeout: 300 }).timeout, 120);
  assert.equal(sanitizeToolArgs("xclaw_bash", { timeout: 300000 }).timeout, 120);
  assert.equal(sanitizeToolArgs("swarm_bash", { timeout: 300 }).timeout, 120);
});

test("sanitizeToolArgs resets negative and non-numeric timeouts to 30", () => {
  assert.equal(sanitizeToolArgs("xclaw_bash", { timeout: -5 }).timeout, 30);
  assert.equal(sanitizeToolArgs("xclaw_bash", { timeout: "nope" }).timeout, 30);
});
