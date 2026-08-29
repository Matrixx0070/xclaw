/**
 * The deploy restart command had a timeout that could not fire.
 *
 * `restartGateway` spawned without `detached`, so `child.kill("SIGKILL")`
 * signalled only the direct pid. Anything that backgrounds work — and
 * `pm2 restart` is exactly that shape — leaves a grandchild holding the write
 * end of the stdio pipe, and the promise settles on `'close'`, which waits for
 * BOTH streams to reach EOF. Measured against a verbatim copy of the shipped
 * primitive: a 500ms timeout resolved after 6005ms — and resolved with
 * **code 0**, so the caller was affirmatively told the command succeeded. There
 * was no exit code by which an overrun could be detected.
 *
 * That matters more here than in most places: `runDeployWatch` awaits
 * `runDeployOnce` serially in a `while` loop, so a grandchild that never exits
 * freezes the whole `xclaw-deployer` process — permanently, and silently.
 *
 * The fix is to route through `runProcess`, which spawns into its own process
 * group and signals the GROUP. The assertion that actually proves it is not the
 * wall clock but process-group reachability: the restart script backgrounds a
 * grandchild that writes a marker file, and after the fix that marker is never
 * written because the group kill reached it.
 */
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { runDeployOnce, writeIntent, shouldStashBeforeReset } from "../src/self/deploy.mjs";

const execFileP = promisify(execFile);
const GRANDCHILD_SLEEP_S = 3;

/**
 * `restartGateway` splits restartCmd on whitespace, so a quoted shell body
 * shatters into garbage argv. The command must therefore be a single path.
 */
async function writeRestartScript(dir, markerPath) {
  const scriptPath = path.join(dir, "restart.sh");
  await fs.writeFile(
    scriptPath,
    `#!/bin/bash\n( sleep ${GRANDCHILD_SLEEP_S}; echo late > ${JSON.stringify(markerPath)} ) &\necho restarting\n`,
    { mode: 0o755 },
  );
  return scriptPath;
}

test("restart timeout kills the whole process group, not just the direct child", async () => {
  const configDir = await fs.mkdtemp(path.join(os.tmpdir(), "xclaw-deploy-timeout-"));
  const marker = path.join(configDir, "grandchild-survived");
  const restartCmd = await writeRestartScript(configDir, marker);

  const cfg = {
    paths: { configDir },
    alerting: {},
    self: {
      restartCmd,
      restartTimeoutMs: 400,
      repoDir: configDir,
      // retries 0 → healthOk returns immediately; the point under test is the
      // restart, not the health poll.
      health: { retries: 0, delayMs: 0 },
    },
  };
  await writeIntent(cfg, {
    v: 1,
    missionId: "m-timeout",
    state: "pending",
    attempts: 0,
    mergeCommit: "0123456789abcdef",
  });

  const started = Date.now();
  await runDeployOnce(cfg);
  const elapsed = Date.now() - started;

  // Pre-fix the promise cannot settle before the grandchild exits, and the
  // rollback path restarts a second time, so elapsed is >= 2x the sleep.
  assert.ok(
    elapsed < GRANDCHILD_SLEEP_S * 1000,
    `restart should be bounded by restartTimeoutMs; took ${elapsed}ms`,
  );

  // The real property: the kill reached the backgrounded grandchild.
  await new Promise((r) => setTimeout(r, GRANDCHILD_SLEEP_S * 1000 + 700 - (Date.now() - started)));
  assert.equal(
    await fs.access(marker).then(() => true, () => false),
    false,
    "backgrounded grandchild survived the restart timeout — the kill did not reach the process group",
  );
});

test("rollback still stashes genuine uncommitted work", async () => {
  // Guards the `dirty.code === 0` guard added alongside the migration: the
  // timeout note runProcess appends is non-empty text, so an unguarded
  // `dirty.output.trim()` would run `git stash push` on a repo whose `git
  // status` never actually ran. The guard must not also suppress a real stash.
  const configDir = await fs.mkdtemp(path.join(os.tmpdir(), "xclaw-deploy-stash-"));
  const repoDir = path.join(configDir, "repo");
  await fs.mkdir(repoDir);
  const git = (...args) =>
    execFileP("git", ["-C", repoDir, "-c", "user.name=t", "-c", "user.email=t@t", ...args]);
  await git("init", "-q", "-b", "main");
  // deploy.mjs shells out to git itself, so the identity must live in the repo
  // config — `git stash push` writes a commit and fails without one.
  await git("config", "user.name", "t");
  await git("config", "user.email", "t@t");
  await fs.writeFile(path.join(repoDir, "a.txt"), "one\n");
  await git("add", "a.txt");
  await git("commit", "-qm", "one");
  await fs.writeFile(path.join(repoDir, "a.txt"), "two\n");
  await git("add", "a.txt");
  await git("commit", "-qm", "two");
  const head = (await git("rev-parse", "HEAD")).stdout.trim();
  // Uncommitted work that the rollback must rescue rather than destroy.
  await fs.writeFile(path.join(repoDir, "wip.txt"), "precious\n");

  const cfg = {
    paths: { configDir },
    alerting: {},
    self: { restartCmd: "node --version", repoDir, health: { retries: 0, delayMs: 0 } },
  };
  await writeIntent(cfg, {
    v: 1,
    missionId: "m-stash",
    state: "pending",
    attempts: 0,
    repoDir,
    mergeCommit: head,
  });

  await runDeployOnce(cfg);

  const stashes = (await git("stash", "list")).stdout;
  assert.match(stashes, /xclaw-rollback-rescue m-stash/, "uncommitted work was not stashed");
});

test("stash-before-reset is decided by the exit code, not by output text", () => {
  // The reason the guard exists: both of these carry non-empty output while
  // git never reported a single dirty file.
  assert.equal(
    shouldStashBeforeReset({ code: 128, output: "fatal: not a git repository\n" }),
    false,
    "git's own error text was read as uncommitted work",
  );
  assert.equal(
    shouldStashBeforeReset({
      code: 1,
      output: "\n[xclaw] command timed out after 120000ms and was killed\n",
    }),
    false,
    "the timeout note was read as uncommitted work",
  );
  // …without suppressing the case it is there to protect.
  assert.equal(shouldStashBeforeReset({ code: 0, output: "?? wip.txt\n" }), true);
  assert.equal(shouldStashBeforeReset({ code: 0, output: "   \n" }), false);
  assert.equal(shouldStashBeforeReset(null), false);
});
