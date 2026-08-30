import { describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { runSwarmFanOut, resumeSwarmRun } from "../src/agents/swarm-run.mjs";
import {
  journalPath,
  readJournal,
  computeGraphHash,
  slimResultForJournal,
} from "../src/agents/swarm-journal.mjs";
import { getSwarmRun } from "../src/agents/swarm-store.mjs";

function mkCfg(dir) {
  return {
    paths: { configDir: dir },
    swarm: { enabled: true, maxParallel: 2, mergeEnabled: false, voteEnabled: false, nodeRetries: 0 },
  };
}

/** Counting mock spawner — records which node ids actually executed. */
function countingSpawn({ failIds = new Set() } = {}) {
  const executed = [];
  let seq = 0;
  const spawn = async (opts) => {
    const id = `mock-child-${++seq}`;
    const m = String(opts.task || "").match(/Subtask \(([^)]+)\):/);
    const nodeId = m?.[1] || id;
    executed.push(nodeId);
    if (failIds.has(nodeId)) {
      return { ok: false, id, status: "error", error: "mock failure", result: null };
    }
    return { ok: true, id, status: "done", result: { text: `ok:${nodeId}`, turns: 1, workspace: null } };
  };
  return { spawn, executed };
}

const GRAPH = [
  { id: "a", task: "task a", role: "research" },
  { id: "b", task: "task b", role: "research" },
  { id: "c", task: "task c", role: "research", dependsOn: ["a", "b"] },
];

describe("swarm resume journal", () => {
  it("fresh run writes header + node transitions to the journal", async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "xclaw-journal-"));
    const cfg = mkCfg(dir);
    const { spawn } = countingSpawn();
    const out = await runSwarmFanOut(cfg, {
      goal: "journal test",
      tasks: GRAPH,
      spawnSubagent: spawn,
    });
    assert.equal(out.ok, true);

    const entries = await readJournal(cfg, out.swarmId);
    assert.ok(entries && entries.length >= 7, `entries=${entries?.length}`);
    const header = entries.find((e) => e.type === "run_start");
    assert.ok(header, "run_start header present");
    assert.equal(typeof header.graphHash, "string");
    assert.equal(header.nodes.length, 3);
    const starts = entries.filter((e) => e.type === "node_start").map((e) => e.nodeId);
    const terms = entries.filter((e) => e.type === "node_result").map((e) => e.nodeId);
    assert.deepEqual(new Set(starts), new Set(["a", "b", "c"]));
    assert.deepEqual(new Set(terms), new Set(["a", "b", "c"]));
    for (const e of entries.filter((x) => x.type === "node_result")) {
      assert.equal(e.result.ok, true);
      assert.equal(e.result.toolTrace, undefined, "toolTrace slimmed out");
    }
  });

  it("resume skips completed nodes and finishes the run", async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "xclaw-journal-res-"));
    const cfg = mkCfg(dir);

    // First pass: c fails (its deps succeed) — a and b are journaled ok.
    const first = countingSpawn({ failIds: new Set(["c"]) });
    const out1 = await runSwarmFanOut(cfg, {
      goal: "resume test",
      tasks: GRAPH,
      spawnSubagent: first.spawn,
    });
    assert.equal(out1.status, "partial"); // c failed, a+b succeeded
    assert.equal(out1.ok, false);
    assert.deepEqual(new Set(first.executed), new Set(["a", "b", "c"]));

    // Resume: only c re-runs, now succeeding.
    const second = countingSpawn();
    const out2 = await resumeSwarmRun(cfg, out1.swarmId, {
      spawnSubagent: second.spawn,
    });
    assert.equal(out2.ok, true, JSON.stringify({ code: out2.code, error: out2.error }));
    assert.deepEqual(second.executed, ["c"], "only the failed node re-ran");
    assert.equal(out2.swarmId, out1.swarmId, "same run id");
    const cRes = out2.results.find((r) => r.nodeId === "c");
    assert.equal(cRes.ok, true);
    // Replayed upstream results are present for the summary
    const aRes = out2.results.find((r) => r.nodeId === "a");
    assert.equal(aRes.ok, true);
    // Run record reflects completion
    const rec = await getSwarmRun(cfg, out1.swarmId);
    assert.equal(rec.status, "done");
  });

  it("graph hash mismatch is refused", async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "xclaw-journal-mm-"));
    const cfg = mkCfg(dir);
    const { spawn } = countingSpawn({ failIds: new Set(["b"]) });
    const out1 = await runSwarmFanOut(cfg, {
      goal: "mismatch test",
      tasks: [
        { id: "a", task: "task a" },
        { id: "b", task: "task b" },
      ],
      spawnSubagent: spawn,
    });
    // Tamper: change a task in the stored run record
    const fp = path.join(dir, "swarms", "runs", `${out1.swarmId}.json`);
    const rec = JSON.parse(await fs.readFile(fp, "utf8"));
    rec.graph[1].task = "task b CHANGED";
    await fs.writeFile(fp, JSON.stringify(rec, null, 2));

    const out2 = await resumeSwarmRun(cfg, out1.swarmId, { spawnSubagent: spawn });
    assert.equal(out2.ok, false);
    assert.equal(out2.code, "JOURNAL_GRAPH_MISMATCH");
  });

  it("missing journal and missing run are structured refusals", async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "xclaw-journal-miss-"));
    const cfg = mkCfg(dir);
    const gone = await resumeSwarmRun(cfg, "nope");
    assert.equal(gone.code, "RUN_NOT_FOUND");

    // Run record without a journal (pre-journal runs)
    const { spawn } = countingSpawn();
    const out1 = await runSwarmFanOut(cfg, { goal: "x", tasks: ["a"], spawnSubagent: spawn });
    await fs.rm(journalPath(cfg, out1.swarmId));
    const noJ = await resumeSwarmRun(cfg, out1.swarmId);
    assert.equal(noJ.code, "JOURNAL_NOT_FOUND");
  });

  it("torn trailing journal line is tolerated", async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "xclaw-journal-torn-"));
    const cfg = mkCfg(dir);
    const first = countingSpawn({ failIds: new Set(["c"]) });
    const out1 = await runSwarmFanOut(cfg, {
      goal: "torn test",
      tasks: GRAPH,
      spawnSubagent: first.spawn,
    });
    // Simulate a crash mid-append: torn partial JSON on the last line
    await fs.appendFile(journalPath(cfg, out1.swarmId), '{"type":"node_res');

    const entries = await readJournal(cfg, out1.swarmId);
    assert.ok(entries.every((e) => typeof e.type === "string"), "torn line skipped");

    const second = countingSpawn();
    const out2 = await resumeSwarmRun(cfg, out1.swarmId, { spawnSubagent: second.spawn });
    assert.equal(out2.ok, true);
    assert.deepEqual(second.executed, ["c"]);
  });

  it("hash is stable across store round-trip and slim drops toolTrace", () => {
    const nodes = GRAPH.map((n, i) => ({
      id: n.id,
      task: n.task,
      role: n.role || "research",
      dependsOn: n.dependsOn || [],
      status: i ? "pending" : "done", // status must NOT affect the hash
    }));
    const h1 = computeGraphHash("g", nodes);
    const h2 = computeGraphHash("g", nodes.map((n) => ({ ...n, status: "running", extra: 1 })));
    assert.equal(h1, h2);
    const slim = slimResultForJournal({ nodeId: "a", ok: true, text: "t", toolTrace: [{ big: 1 }] });
    assert.equal(slim.toolTrace, undefined);
    assert.equal(slim.text, "t");
  });
});
