/**
 * P0.3 — Long-horizon job fixtures (no live model).
 * Mirrors verified multi-phase goals: files + command verify + checkpoint recovery.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { spawn } from "node:child_process";
import { runVerifyChecks } from "../src/jobs/verify.mjs";
import {
  saveCheckpoint,
  loadCheckpoint,
  listCheckpoints,
  classifyFailure,
} from "../src/jobs/checkpoint.mjs";

async function buildHelloWorkspace(root) {
  await fs.mkdir(path.join(root, "src"), { recursive: true });
  await fs.mkdir(path.join(root, "tests"), { recursive: true });
  await fs.writeFile(
    path.join(root, "src/hello.mjs"),
    "export function hello(name) {\n  return `Hello, ${name}!`;\n}\n"
  );
  await fs.writeFile(
    path.join(root, "tests/hello.test.mjs"),
    `import test from "node:test";
import assert from "node:assert/strict";
import { hello } from "../src/hello.mjs";
test("hello", () => {
  assert.equal(hello("XClaw"), "Hello, XClaw!");
});
`
  );
  await fs.writeFile(
    path.join(root, "REPORT.md"),
    "# Report\n\nStatus: tests passed\n"
  );
}

function runNodeTest(cwd) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, ["--test", "tests/hello.test.mjs"], {
      cwd,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let out = "";
    child.stdout.on("data", (d) => (out += d));
    child.stderr.on("data", (d) => (out += d));
    child.on("close", (code) => resolve({ code, out }));
  });
}

describe("long-horizon fixtures", () => {
  it("multi-phase hello workspace verifies + node --test passes", async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "xclaw-lh-"));
    await buildHelloWorkspace(dir);

    const node = await runNodeTest(dir);
    assert.equal(node.code, 0, node.out);

    const verify = await runVerifyChecks(dir, [
      { type: "file_exists", path: "src/hello.mjs" },
      { type: "file_exists", path: "tests/hello.test.mjs" },
      { type: "file_exists", path: "REPORT.md" },
      { type: "file_contains", path: "src/hello.mjs", text: "hello" },
      { type: "file_contains", path: "REPORT.md", text: "pass" },
      { type: "command", cmd: "node --test tests/hello.test.mjs", exitCode: 0 },
    ]);
    assert.equal(verify.ok, true, JSON.stringify(verify.results));
  });

  it("absolute verify paths resolve outside relative join bugs", async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "xclaw-lh-abs-"));
    const proof = path.join(dir, "queued.txt");
    await fs.writeFile(proof, "QUEUE_OK\n");
    const verify = await runVerifyChecks(dir, [
      { type: "file_exists", path: proof },
      { type: "file_contains", path: proof, text: "QUEUE_OK" },
    ]);
    assert.equal(verify.ok, true, JSON.stringify(verify.results));
  });

  it("checkpoint incomplete → list → load → classify transport", async () => {
    const cfgDir = await fs.mkdtemp(path.join(os.tmpdir(), "xclaw-lh-cp-"));
    const ws = await fs.mkdtemp(path.join(os.tmpdir(), "xclaw-lh-ws-"));
    await fs.writeFile(path.join(ws, "a.txt"), "AAA\n");
    // only a.txt present — incomplete 3-file goal
    const verify = await runVerifyChecks(ws, [
      { type: "file_exists", path: "a.txt" },
      { type: "file_exists", path: "b.txt" },
      { type: "file_exists", path: "c.txt" },
    ]);
    assert.equal(verify.ok, false);

    const cfg = { paths: { configDir: cfgDir } };
    await saveCheckpoint(cfg, {
      id: "job_lh_incomplete",
      goal: "create a.txt b.txt c.txt",
      workspace: ws,
      status: "failed",
      pass: false,
      turns: 2,
      text: "wrote a.txt only",
      error: null,
      verify,
      maxTurns: 8,
    });

    const list = await listCheckpoints(cfg, { limit: 5 });
    assert.ok(list.some((c) => c.id === "job_lh_incomplete"));

    const cp = await loadCheckpoint(cfg, "job_lh_incomplete");
    assert.equal(cp.pass, false);
    assert.equal(cp.workspace, ws);

    // Simulate recovery write of remaining files
    await fs.writeFile(path.join(ws, "b.txt"), "BBB\n");
    await fs.writeFile(path.join(ws, "c.txt"), "CCC\n");
    const verify2 = await runVerifyChecks(ws, [
      { type: "file_exists", path: "a.txt" },
      { type: "file_exists", path: "b.txt" },
      { type: "file_exists", path: "c.txt" },
    ]);
    assert.equal(verify2.ok, true);

    assert.equal(classifyFailure("ECONNREFUSED computer"), "transport");
    assert.equal(classifyFailure("maxTurns exceeded"), "budget");
  });

  it("already-passed checkpoint does not need resume work", async () => {
    const cfgDir = await fs.mkdtemp(path.join(os.tmpdir(), "xclaw-lh-pass-"));
    const cfg = { paths: { configDir: cfgDir } };
    await saveCheckpoint(cfg, {
      id: "job_lh_pass",
      goal: "done",
      workspace: cfgDir,
      status: "succeeded",
      pass: true,
      turns: 3,
      text: "ok",
      maxTurns: 8,
    });
    const { resumeJobFromCheckpoint } = await import("../src/jobs/checkpoint.mjs");
    const out = await resumeJobFromCheckpoint(cfg, "job_lh_pass");
    assert.equal(out.resumed, false);
    assert.equal(out.note, "already passed");
  });
});
