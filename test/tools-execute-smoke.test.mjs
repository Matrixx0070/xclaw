import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createAllLocalTools } from "../src/tools/registry.mjs";
import { createBrowserTools } from "../src/tools/browser-tools.mjs";

// Real incident (2026-08-13): browser-tools.mjs shipped with 22 identifiers
// referenced across six tools that were never imported — fabric_status,
// tab_lease, commit_gate, session_role, trace_replay/score, browser_assert
// all ReferenceError'd on every execute(). The suite stayed green for weeks
// because nothing in it ever actually CALLED these tools' execute() bodies —
// import-time checks don't catch a free identifier that's only referenced
// inside a function, since JS doesn't resolve module bindings until the
// code path runs.
//
// This sweep calls execute() on every registered local + browser tool with
// minimal/safe arguments (chosen by reading each tool's own fail-fast
// validation so nothing here reaches a real network call, paid API, or
// slow subprocess) and asserts none of them throw. It's a smoke test, not
// full behavioral coverage — a bug deep in a rarely-hit branch can still
// slip through — but it directly re-creates how the original bug was found
// and generalizes that discovery method across the whole tool surface.

// Second real incident (2026-08-28): the contract above only ever considered
// tools reaching OUT (network, paid API, subprocess) and never one writing IN
// to operator state. mitm_export wrote a real audit bundle into the operator's
// ~/.xclaw/mitm/proofs on every run — 1206 files accumulated from the day this
// file was added. Executing a tool for real means its writes are real too, so
// the sweep now runs against a sandbox and asserts the operator's own state is
// untouched. Safety contract, restated: nothing here may reach a real network
// call, paid API, slow subprocess, OR any path under the operator's ~/.xclaw.
//
// The mitm sandbox is supplied through cfg ALONE (XCLAW_MITM_CONFDIR is cleared
// for the duration) so this doubles as the regression pin for the defect that
// caused the pollution: every confdir resolution in the truth/sense plane must
// honour cfg. If any of them drops it again, the write lands in real home and
// PROOFS_BEFORE/AFTER below goes red.
const MISSING_PATH = "/xclaw-smoke-test-definitely-missing-file.ext";

// Chosen so each tool's OWN validation (fs.access/fs.stat on a path that
// cannot exist) fails fast, before any subprocess or network call.
const ARGS_OVERRIDES = {
  file_type: { path: MISSING_PATH },
  ocr: { path: MISSING_PATH },
  office_convert: { path: MISSING_PATH },
  view_image: { path: MISSING_PATH },
  view_x_video: { path: MISSING_PATH },
};

// Checks a bearer-token env var BEFORE validating its own required field —
// on a host with X_BEARER_TOKEN configured, `{}` args would reach a real
// (harmless but unwanted) network call. Structural presence is asserted
// instead of live invocation.
const EXCLUDED = new Set(["x_thread_fetch"]);

function withTimeout(promise, ms, label) {
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms);
  });
  return Promise.race([Promise.resolve(promise), timeout]).finally(() => clearTimeout(timer));
}

async function sweep(tools, { minCount, argsFor = () => ({}) } = {}) {
  assert.ok(tools.length >= minCount, `expected >= ${minCount} tools, got ${tools.length}`);
  const failures = [];
  for (const tool of tools) {
    if (EXCLUDED.has(tool.name)) {
      assert.equal(typeof tool.execute, "function", `${tool.name}: has an execute function`);
      continue;
    }
    const args = argsFor(tool.name);
    try {
      const result = await withTimeout(tool.execute(args), 20_000, tool.name);
      assert.ok(
        result && typeof result === "object",
        `${tool.name}: execute() returned a result object`
      );
    } catch (e) {
      failures.push(`${tool.name}: ${e?.constructor?.name || "Error"}: ${e?.message || e}`);
    }
  }
  assert.deepEqual(failures, [], `tools that threw:\n${failures.join("\n")}`);
}

const REAL_PROOFS = path.join(
  process.env.HOME || os.homedir(),
  ".xclaw",
  "mitm",
  "proofs"
);

async function countProofs() {
  try {
    return (await fs.readdir(REAL_PROOFS)).length;
  } catch {
    return 0; // no operator state on this host — nothing to protect
  }
}

describe("tool execute-smoke sweep", () => {
  let sandbox;
  let mitmDir;
  let proofsBefore;
  const savedEnv = {};

  before(async () => {
    sandbox = await fs.mkdtemp(path.join(os.tmpdir(), "xclaw-smoke-"));
    mitmDir = path.join(sandbox, "mitm");
    for (const k of ["XCLAW_MITM_CONFDIR", "XCLAW_FABRIC_DIR"]) {
      savedEnv[k] = process.env[k];
    }
    // cfg must be the ONLY thing steering the mitm confdir (see note above).
    delete process.env.XCLAW_MITM_CONFDIR;
    // Fabric has no cfg path; env is its only redirect.
    process.env.XCLAW_FABRIC_DIR = path.join(sandbox, "fabric");
    proofsBefore = await countProofs();
  });

  after(async () => {
    for (const [k, v] of Object.entries(savedEnv)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
    if (sandbox) await fs.rm(sandbox, { recursive: true, force: true });
  });

  it("every local tool executes without an unhandled throw", async () => {
    const tools = createAllLocalTools({
      workingDir: process.cwd(),
      cfg: { browser: { mitm: { confdir: mitmDir } } },
    });
    await sweep(tools, {
      minCount: 15,
      argsFor: (name) => ARGS_OVERRIDES[name] || {},
    });
  });

  it("every browser tool executes without an unhandled throw, given a stub computer client", async () => {
    const stubComputer = {
      async callTool(sessionId, name, args) {
        return {
          content: [{ type: "text", text: "stub-ok" }],
          metadata: { stub: true, name, args },
        };
      },
    };
    const tools = createBrowserTools({
      computer: stubComputer,
      sessionId: "smoke-test",
      workingDir: process.cwd(),
      cfg: { browser: { mitm: { confdir: mitmDir } } },
    });
    await sweep(tools, { minCount: 18 });
  });

  it("the sweep wrote its artifacts to the sandbox, not the operator's ~/.xclaw", async () => {
    // Anti-vacuity: the sweep really does export proof bundles, so the
    // assertion below is about WHERE they went, not whether any were written.
    const sandboxProofs = await fs
      .readdir(path.join(mitmDir, "proofs"))
      .catch(() => []);
    assert.ok(
      sandboxProofs.length >= 1,
      `expected the sweep's proof bundles in the cfg confdir, found none in ${mitmDir}/proofs`
    );
    assert.equal(
      await countProofs(),
      proofsBefore,
      `the sweep wrote into the operator's real ${REAL_PROOFS} — a confdir resolution dropped cfg`
    );
  });
});
