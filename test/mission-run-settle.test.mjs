/**
 * Same class as queue cancel overwritten by a long-running writer:
 * rollbackMission persists rolled_back (and abort()s the running map)
 * while runMission is inside unbounded runVerification. sh() takes no
 * abort signal, so the abort cannot interrupt the verify cmd. The
 * success-path saveMission after verify must not overwrite rolled_back
 * with verifying/failed/merge_ready.
 *
 * Catch already re-reads TERMINAL_STATUSES. This pin is the success
 * path: bailIfAborted after runVerification / captureDiff so the throw
 * reaches that catch.
 */
import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import os from "os";
import { spawnSync } from "node:child_process";
import { startMission, rollbackMission } from "../src/missions/engine.mjs";
import { loadMission } from "../src/missions/store.mjs";

function git(args, cwd) {
  return spawnSync("git", args, { cwd, encoding: "utf8" });
}

describe("runMission does not overwrite a concurrent rollback after verify", () => {
  let dir;
  let repo;

  before(async () => {
    dir = await fsp.mkdtemp(path.join(os.tmpdir(), "xclaw-run-settle-"));
    repo = path.join(dir, "repo");
    fs.mkdirSync(repo);
    git(["init", "-q"], repo);
    git(["config", "user.email", "t@x"], repo);
    git(["config", "user.name", "t"], repo);
    fs.writeFileSync(path.join(repo, "a.js"), "one\n");
    git(["add", "."], repo);
    git(["commit", "-qm", "init"], repo);
  });

  after(async () => {
    await fsp.rm(dir, { recursive: true, force: true });
  });

  it("leaves rolled_back on disk when rollback lands during runVerification", async () => {
    const cfg = {
      paths: { configDir: dir },
      agent: { maxTurns: 4, persistTranscript: false },
      tokens: { enabled: false, ledger: false },
      skills: { enabled: false },
      memory: { enabled: false },
      computer: { autoStart: false },
      security: { autoApprove: true },
      hooks: { log: false },
      missions: { maxAttempts: 1, maxTurnsPerPhase: 4 },
    };
    const ref = {};
    const provider = {
      providerName: "fake",
      model: "fake-1",
      baseUrl: "http://127.0.0.1:1",
      async chat({ messages }) {
        const t = messages
          .filter((m) => m.role === "user")
          .map((m) => m.content)
          .join("\n");
        if (/Implement this mission/i.test(t) && ref.id) {
          const m = await loadMission(cfg, ref.id);
          if (m?.worktree?.path) {
            fs.writeFileSync(path.join(m.worktree.path, "a.js"), "two\n");
          }
        }
        return { message: { role: "assistant", content: "done" }, finishReason: "stop" };
      },
    };
    const started = await startMission(cfg, {
      goal: "change a.js",
      repoDir: repo,
      provider,
      verify: ["sleep 1"],
    });
    ref.id = started.id;
    for (let i = 0; i < 80; i++) {
      await new Promise((r) => setTimeout(r, 50));
      const cur = await loadMission(cfg, started.id);
      if (cur?.status === "verifying") break;
    }
    const rb = await rollbackMission(cfg, started.id);
    assert.equal(rb.status, "rolled_back");
    await new Promise((r) => setTimeout(r, 1500));
    const onDisk = await loadMission(cfg, started.id);
    assert.equal(onDisk.status, "rolled_back");
    assert.notEqual(onDisk.status, "verifying");
    assert.notEqual(onDisk.status, "failed");
    assert.notEqual(onDisk.status, "merge_ready");
  });

  it("is wired after runVerification, captureDiff, tournament, swarm, createWorktree", async () => {
    const src = await fsp.readFile(new URL("../src/missions/engine.mjs", import.meta.url), "utf8");
    const body = src.slice(src.indexOf("async function runMission("));
    const end = body.indexOf("export function settleAfterMerge");
    const run = end > 0 ? body.slice(0, end) : body;

    function after(needle) {
      const i = run.indexOf(needle);
      assert.ok(i >= 0, `${needle} present`);
      const window = run.slice(i, i + 400);
      assert.match(window, /await bailIfAborted\(\)/, `bailIfAborted after ${needle}`);
    }
    after("await createWorktree(");
    after("await runMissionTournament(");
    after("await runMissionSwarm(");
    after("await runVerification(");
    after("await captureDiff(cfg, mission);");
  });
});
