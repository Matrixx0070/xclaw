import { describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "path";
import os from "os";
import {
  resolveMergePolicy,
  evaluateMergeGates,
  collectMergeCandidates,
  saveMergeProposal,
  getMergeProposal,
  rejectMergeProposal,
  approveMergeProposal,
} from "../src/agents/swarm-merge.mjs";

describe("S3 merge policy", () => {
  it("prod-like defaults disable autoMerge", () => {
    const p = resolveMergePolicy({ profile: "prod", swarm: {} });
    assert.equal(p.autoMerge, false);
    assert.equal(p.requireVerify, true);
  });

  it("explicit autoMerge wins", () => {
    const p = resolveMergePolicy(
      { profile: "prod", swarm: { autoMerge: false } },
      { autoMerge: true }
    );
    assert.equal(p.autoMerge, true);
  });

  it("S4 flags default off", () => {
    const p = resolveMergePolicy({ swarm: {} });
    assert.equal(p.requireCleanMain, false);
    assert.equal(p.useIndex, false);
  });

  it("S4 flags enable from config", () => {
    const p = resolveMergePolicy({
      swarm: { mergeRequireCleanMain: true, mergeUseIndex: true },
    });
    assert.equal(p.requireCleanMain, true);
    assert.equal(p.useIndex, true);
  });
});

describe("S3 merge gates", () => {
  it("blocks when verify failed", () => {
    const g = evaluateMergeGates(
      [
        { nodeId: "impl", role: "implement", ok: true },
        { nodeId: "verify", role: "verify", ok: false },
      ],
      { requireVerify: true }
    );
    assert.equal(g.ok, false);
    assert.match(g.reasons.join(" "), /verify/);
  });

  it("passes when verify ok", () => {
    const g = evaluateMergeGates(
      [
        { nodeId: "impl", role: "implement", ok: true },
        { nodeId: "verify", role: "verify", ok: true },
      ],
      { requireVerify: true }
    );
    assert.equal(g.ok, true);
  });

  it("blocks on critic language when required", () => {
    const g = evaluateMergeGates(
      [
        { nodeId: "impl", role: "implement", ok: true },
        {
          nodeId: "c",
          role: "critic",
          ok: true,
          text: "This is a blocking issue — do not merge",
        },
      ],
      { requireVerify: false, requireCriticPass: true }
    );
    assert.equal(g.ok, false);
  });
});

describe("S3 candidates", () => {
  it("collects implement workspaces", () => {
    const c = collectMergeCandidates([
      {
        nodeId: "impl",
        role: "implement",
        ok: true,
        workspace: "/tmp/wt-1",
      },
      { nodeId: "r", role: "research", ok: true },
    ]);
    assert.equal(c.length, 1);
    assert.equal(c[0].worktreePath, "/tmp/wt-1");
  });
});

describe("S3 merge proposals durable", () => {
  it("save get reject proposal", async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "xclaw-s3-"));
    const cfg = { paths: { configDir: dir } };
    const rec = await saveMergeProposal(cfg, {
      swarmId: "swarm-1",
      repoDir: dir,
      policy: { autoMerge: false },
      items: [{ nodeId: "impl", worktreePath: "/tmp/x", checkOk: true }],
    });
    assert.ok(rec.id);
    const loaded = await getMergeProposal(cfg, rec.id);
    assert.equal(loaded.status, "pending");
    const rej = await rejectMergeProposal(cfg, rec.id, "nope");
    assert.equal(rej.ok, true);
    const again = await getMergeProposal(cfg, rec.id);
    assert.equal(again.status, "rejected");
  });

  it("approve missing proposal", async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "xclaw-s3b-"));
    const cfg = { paths: { configDir: dir } };
    const out = await approveMergeProposal(cfg, "does-not-exist");
    assert.equal(out.ok, false);
    assert.equal(out.code, "PROPOSAL_NOT_FOUND");
  });

  it("approve fails when repo path missing", async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "xclaw-s3repo-"));
    const cfg = { paths: { configDir: dir } };
    const missing = path.join(dir, "does-not-exist-repo");
    const rec = await saveMergeProposal(cfg, {
      swarmId: "s",
      repoDir: missing,
      policy: {},
      items: [{ nodeId: "impl", worktreePath: path.join(dir, "wt") }],
    });
    const out = await approveMergeProposal(cfg, rec.id, { repoDir: missing });
    assert.equal(out.ok, false);
    assert.equal(out.code, "REPO_MISSING");
    assert.ok(Array.isArray(out.hints));
  });
});
