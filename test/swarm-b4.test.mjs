import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "path";
import os from "os";
import {
  appendEntry,
  readEntries,
  tailDigest,
  createBlackboardTool,
} from "../src/agents/blackboard.mjs";
import { normalizeTaskGraph, runSwarmFanOut } from "../src/agents/swarm-run.mjs";

describe("B4 blackboard", () => {
  let dir;
  let cfg;
  before(async () => {
    dir = await fs.mkdtemp(path.join(os.tmpdir(), "xclaw-bb-"));
    cfg = { paths: { configDir: dir } };
  });
  after(async () => {
    await fs.rm(dir, { recursive: true, force: true });
  });

  it("append/read/tailDigest round-trip with bounds", async () => {
    await appendEntry(cfg, "run1", { nodeId: "a", role: "research", kind: "finding", text: "X".repeat(5000) });
    await appendEntry(cfg, "run1", { nodeId: "b", role: "implement", kind: "decision", text: "use approach 2" });
    const entries = await readEntries(cfg, "run1");
    assert.equal(entries.length, 2);
    assert.equal(entries[0].text.length, 2000, "entries are clamped");
    const digest = await tailDigest(cfg, "run1");
    assert.ok(digest.includes("use approach 2"));
    assert.ok(digest.length <= 1500);
    assert.equal(await tailDigest(cfg, "empty-run"), null);
  });

  it("tool posts and reads, bound to its node", async () => {
    const tool = createBlackboardTool({ cfg, runId: "run2", nodeId: "n1", role: "research" });
    const posted = await tool.execute({ action: "post", kind: "question", text: "which port?" });
    assert.ok(posted.ok);
    assert.equal(posted.posted.nodeId, "n1");
    const read = await tool.execute({ action: "read" });
    assert.equal(read.entries.length, 1);
    const bad = await tool.execute({ action: "post" });
    assert.equal(bad.ok, false);
  });
});

describe("B4 dynamic roles + tournament graph fields", () => {
  it("normalizeTaskGraph carries rolePrompt/tools/earlyMerge; unknown role is a label", () => {
    const { nodes, error } = normalizeTaskGraph([
      {
        id: "sec",
        role: "security-auditor",
        rolePrompt: "You are a security auditor. Only report vulnerabilities.",
        tools: ["glob", "grep", "xclaw_file_read"],
        task: "audit the auth module",
      },
      { id: "impl", role: "implement", task: "fix findings", dependsOn: ["sec"], earlyMerge: false },
    ]);
    assert.equal(error, undefined);
    assert.equal(nodes[0].role, "security-auditor");
    assert.ok(nodes[0].rolePrompt.startsWith("You are a security auditor"));
    assert.deepEqual(nodes[0].tools, ["glob", "grep", "xclaw_file_read"]);
    assert.equal(nodes[1].earlyMerge, false);
  });

  it("fan-out passes narrowed tools + blackboard tool + rolePrompt to spawn (seam)", async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "xclaw-b4run-"));
    const cfg = {
      paths: { configDir: dir },
      agent: { allowTools: ["glob", "grep", "xclaw_file_*", "web_search"] },
      swarm: { mergeEnabled: false, voteEnabled: false },
    };
    const spawns = [];
    const seam = async (opts) => {
      spawns.push(opts);
      return { id: `sa_${spawns.length}`, ok: true, status: "done", result: { text: "ok", turns: 1, toolTrace: [] } };
    };
    const res = await runSwarmFanOut(cfg, {
      goal: "test",
      tasks: [
        {
          id: "x",
          role: "custom-lens",
          rolePrompt: "Custom lens role.",
          tools: ["glob", "xclaw_file_read", "not_allowed_tool"],
          task: "look",
        },
      ],
      spawnSubagent: seam,
    });
    assert.ok(res.ok, JSON.stringify(res).slice(0, 300));
    const s = spawns[0];
    assert.ok(s.task.startsWith("Custom lens role."), "rolePrompt drives the prompt prefix");
    // intersection: not_allowed_tool dropped (no matching parent pattern),
    // xclaw_file_read kept via xclaw_file_* pattern, blackboard appended
    assert.deepEqual(s.allowTools, ["glob", "xclaw_file_read", "xclaw_blackboard"]);
    assert.ok(s.extraTools?.some((t) => t.name === "xclaw_blackboard"));
    await fs.rm(dir, { recursive: true, force: true });
  });

  it("earlyMerge:false nodes are held (compete-hold), not merged early", async () => {
    const { mergeImplementNodeEarly } = await import("../src/agents/swarm-run.mjs");
    const held = await mergeImplementNodeEarly(
      {},
      { ok: true, role: "implement", earlyMerge: false, nodeId: "impl1", workspace: "/tmp/x" },
      { autoMerge: true },
      null
    );
    assert.equal(held.skipped, true);
    assert.equal(held.method, "compete-hold");
  });
});
