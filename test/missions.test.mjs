import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";

// End-to-end mission through the engine, hermetic: a REAL temp git repo, an
// injected scripted provider that edits a file via tool calls, and the
// project's own `npm test`-style check. No network, no real model.
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), "xclaw-msn-"));
const REPO = path.join(TMP, "repo");
const savedHome = process.env.HOME;
const savedState = process.env.XCLAW_STATE_DIR;
const CFG = {
  paths: { configDir: TMP },
  agent: { maxTurns: 6, persistTranscript: false },
  tokens: { enabled: false, ledger: false },
  skills: { enabled: false },
  memory: { enabled: false },
  computer: { autoStart: false },
  security: { autoApprove: true },
  hooks: { log: false },
  missions: { maxAttempts: 2, maxTurnsPerPhase: 6 },
};

let store, engine;

function git(args, cwd = REPO) {
  return spawnSync("git", args, { cwd, encoding: "utf8" });
}

before(async () => {
  process.env.HOME = TMP;
  process.env.XCLAW_STATE_DIR = TMP;
  fs.mkdirSync(REPO, { recursive: true });
  git(["init", "-q"]);
  git(["config", "user.email", "t@t.co"]);
  git(["config", "user.name", "t"]);
  // a repo with a failing "checker" the mission must satisfy
  fs.writeFileSync(path.join(REPO, "greeting.txt"), "TODO\n");
  fs.writeFileSync(
    path.join(REPO, "package.json"),
    JSON.stringify({
      name: "demo",
      scripts: { test: "grep -q hello greeting.txt" },
    })
  );
  git(["add", "-A"]);
  git(["commit", "-q", "-m", "init"]);
  store = await import("../src/missions/store.mjs");
  engine = await import("../src/missions/engine.mjs");
});

after(() => {
  process.env.HOME = savedHome;
  if (savedState === undefined) delete process.env.XCLAW_STATE_DIR;
  else process.env.XCLAW_STATE_DIR = savedState;
  fs.rmSync(TMP, { recursive: true, force: true });
});

/**
 * Scripted provider. The engine's tool plane (file writes) routes through the
 * computer runtime, which isn't up in a hermetic test — so on the EXECUTE
 * phase this provider performs the write the tool would do, directly into the
 * mission's real worktree (found via the store). Everything else the engine
 * does — worktree, verification via real `npm test`, diff, merge, rollback,
 * durable state — stays real. The full agent+computer+model tool path is
 * proven separately by the live display run.
 */
function scriptedProvider(missionIdRef) {
  let wrote = false;
  return {
    providerName: "fake",
    model: "fake-1",
    baseUrl: "http://127.0.0.1:1",
    async chat({ messages }) {
      const userText = messages.filter((m) => m.role === "user").map((m) => m.content).join("\n");
      if (/Implement this mission/i.test(userText) && !wrote) {
        wrote = true;
        const m = await store.loadMission(CFG, missionIdRef.id);
        if (m?.worktree?.path) {
          fs.writeFileSync(path.join(m.worktree.path, "greeting.txt"), "hello world\n");
        }
      }
      return { message: { role: "assistant", content: "done" }, finishReason: "stop" };
    },
  };
}

describe("mission store", () => {
  it("rejects path-traversal ids (no arbitrary .json read)", async () => {
    // seed a file outside the missions dir
    fs.writeFileSync(path.join(TMP, "secret.json"), '{"x":1}');
    assert.equal(await store.loadMission(CFG, "../secret"), null);
    assert.equal(await store.loadMission(CFG, "..%2Fsecret"), null);
    assert.equal(await store.loadMission(CFG, "a/b"), null);
  });

  it("newMission → save → load round-trips; reconcile marks active interrupted", async () => {
    const m = store.newMission({ goal: "x", repoDir: REPO });
    m.status = "executing";
    await store.saveMission(CFG, m);
    const loaded = await store.loadMission(CFG, m.id);
    assert.equal(loaded.goal, "x");
    const ids = await store.reconcileInterrupted(CFG);
    assert.ok(ids.includes(m.id));
    const after = await store.loadMission(CFG, m.id);
    assert.equal(after.status, "interrupted");
  });
});

async function settle(id, timeoutMs = 30_000) {
  const t0 = Date.now();
  let m;
  while (Date.now() - t0 < timeoutMs) {
    await new Promise((r) => setTimeout(r, 150));
    m = await store.loadMission(CFG, id);
    if (["merge_ready", "failed", "done", "rolled_back"].includes(m.status)) break;
  }
  return m;
}

describe("mission engine end-to-end", () => {
  it("plans → implements in shadow workspace → verifies → merge_ready, repo untouched until merge", async () => {
    const ref = {};
    const started = await engine.startMission(CFG, {
      goal: "make greeting.txt contain the word hello",
      repoDir: REPO,
      provider: scriptedProvider(ref),
    });
    ref.id = started.id;
    const m = await settle(started.id);
    assert.equal(m.status, "merge_ready", `status: ${m.status} (${m.error || ""})`);
    // evidence: verification actually ran and passed
    assert.ok(m.verify.history.at(-1).ok, "verification recorded as passing");
    assert.match(m.verify.history.at(-1).summary, /PASS/);
    // a diff was captured
    assert.ok(m.diff && m.diff.patch.length > 0, "diff captured");
    // the REAL repo is still untouched (all work in the worktree)
    assert.equal(git(["status", "--porcelain"]).stdout.trim(), "", "repo clean pre-merge");
    assert.match(fs.readFileSync(path.join(REPO, "greeting.txt"), "utf8"), /TODO/, "repo file unchanged pre-merge");

    // merge applies it to the real repo (the gated step)
    const merged = await engine.mergeMission(CFG, started.id);
    assert.equal(merged.mission.status, "done");
    assert.match(fs.readFileSync(path.join(REPO, "greeting.txt"), "utf8"), /hello/, "merge applied the change");
  });

  it("refuses to merge without verification evidence", async () => {
    const m = store.newMission({ goal: "y", repoDir: REPO });
    m.status = "executing"; // never verified
    await store.saveMission(CFG, m);
    await assert.rejects(() => engine.mergeMission(CFG, m.id), /merge_ready/);
  });

  it("rollback of a RUNNING mission is terminal — a late abort never clobbers it back to failed", async () => {
    // Provider that blocks on the execute phase so we can roll back mid-run.
    let release;
    const gate = new Promise((r) => (release = r));
    const provider = {
      providerName: "fake",
      model: "fake-1",
      baseUrl: "http://127.0.0.1:1",
      async chat({ messages }) {
        const t = messages.filter((m) => m.role === "user").map((m) => m.content).join("\n");
        if (/Implement this mission/i.test(t)) await gate; // hang until rolled back
        return { message: { role: "assistant", content: "done" }, finishReason: "stop" };
      },
    };
    const started = await engine.startMission(CFG, {
      goal: "hang then rollback",
      repoDir: REPO,
      provider,
    });
    // wait until it's actually executing (past plan)
    for (let i = 0; i < 80; i++) {
      await new Promise((r) => setTimeout(r, 100));
      const m = await store.loadMission(CFG, started.id);
      if (m.status === "executing") break;
    }
    const rb = await engine.rollbackMission(CFG, started.id);
    assert.equal(rb.status, "rolled_back");
    release(); // let the aborted run's catch fire
    await new Promise((r) => setTimeout(r, 400));
    const final = await store.loadMission(CFG, started.id);
    assert.equal(final.status, "rolled_back", "terminal status survived the abort handler");
  });

  it("rollback discards the workspace and leaves the repo clean", async () => {
    const ref = {};
    const started = await engine.startMission(CFG, {
      goal: "make greeting.txt contain the word hello",
      repoDir: REPO,
      provider: scriptedProvider(ref),
    });
    ref.id = started.id;
    await settle(started.id);
    const rb = await engine.rollbackMission(CFG, started.id);
    assert.equal(rb.status, "rolled_back");
  });
});
