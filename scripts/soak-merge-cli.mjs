#!/usr/bin/env node
/**
 * Live soak: S3/S4/S5 merge approve via CLI-equivalent API.
 *
 *   node scripts/soak-merge-cli.mjs
 *   node scripts/soak-merge-cli.mjs --use-index
 *   node scripts/soak-merge-cli.mjs --require-clean
 *
 * Creates a throwaway git repo + worktree, builds a pending proposal,
 * then approveMergeProposal (same path as `xclaw merge approve`).
 */
import { spawnSync } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import {
  saveMergeProposal,
  approveMergeProposal,
  getMergeProposal,
  rejectMergeProposal,
} from "../src/agents/swarm-merge.mjs";
import { inspectRepoCleanliness } from "../src/agents/worktree.mjs";

function run(cmd, args, cwd) {
  const r = spawnSync(cmd, args, { cwd, encoding: "utf8" });
  return {
    code: r.status ?? 1,
    stdout: r.stdout || "",
    stderr: r.stderr || "",
  };
}

function log(step, data) {
  console.log(`\n=== ${step} ===`);
  if (typeof data === "string") console.log(data);
  else console.log(JSON.stringify(data, null, 2));
}

async function main() {
  const useIndex = process.argv.includes("--use-index");
  const requireClean = process.argv.includes("--require-clean");
  const rejectOnly = process.argv.includes("--reject-only");

  const base = await fs.mkdtemp(path.join(os.tmpdir(), "xclaw-soak-merge-"));
  const repo = path.join(base, "repo");
  const cfgDir = path.join(base, "xclaw-home");
  await fs.mkdir(repo, { recursive: true });
  await fs.mkdir(cfgDir, { recursive: true });

  const cfg = {
    paths: { configDir: cfgDir },
    profile: "lab",
    swarm: {
      mergeRequireCleanMain: requireClean,
      mergeUseIndex: useIndex,
      autoMerge: false,
    },
  };

  // --- init main repo ---
  run("git", ["init"], repo);
  run("git", ["config", "user.email", "soak@xclaw.test"], repo);
  run("git", ["config", "user.name", "XClaw Soak"], repo);
  await fs.writeFile(path.join(repo, "README.md"), "# soak\n");
  await fs.writeFile(path.join(repo, "app.js"), "export const v = 1;\n");
  run("git", ["add", "."], repo);
  run("git", ["commit", "-m", "init"], repo);

  // --- worktree with change ---
  const wt = path.join(base, "wt");
  const add = run("git", ["worktree", "add", "-b", "xclaw/soak", wt], repo);
  if (add.code !== 0) {
    log("worktree add failed", add.stderr || add.stdout);
    process.exit(1);
  }
  await fs.writeFile(
    path.join(wt, "app.js"),
    "export const v = 2; // soak change\n"
  );
  // leave uncommitted so git diff HEAD in worktree captures it

  const cleanliness = await inspectRepoCleanliness(repo);
  log("main cleanliness (before)", cleanliness);

  const proposal = await saveMergeProposal(cfg, {
    swarmId: "soak-swarm",
    repoDir: repo,
    policy: {
      autoMerge: false,
      requireCleanMain: requireClean,
      useIndex: useIndex,
      cleanupWorktree: false,
    },
    items: [
      {
        nodeId: "impl",
        childId: "mock-child",
        worktreePath: wt,
        checkOk: true,
      },
    ],
  });
  log("proposal created", {
    id: proposal.id,
    status: proposal.status,
    repoDir: proposal.repoDir,
  });

  // Simulate CLI: xclaw merge list
  const { listMergeProposals } = await import("../src/agents/swarm-merge.mjs");
  const pending = await listMergeProposals(cfg, { status: "pending" });
  log(
    "merge list (pending)",
    pending.map((p) => ({ id: p.id.slice(0, 8), status: p.status }))
  );

  if (rejectOnly) {
    const rej = await rejectMergeProposal(cfg, proposal.id, "soak reject path");
    log("merge reject", rej);
    process.exit(rej.ok ? 0 : 1);
  }

  // Simulate CLI: xclaw merge approve <id>
  const out = await approveMergeProposal(cfg, proposal.id, {
    repoDir: repo,
    useIndex,
    requireCleanMain: requireClean,
  });
  log("merge approve", out);

  const after = await getMergeProposal(cfg, proposal.id);
  log("proposal after", { status: after?.status, approveResult: after?.approveResult });

  const mainApp = await fs.readFile(path.join(repo, "app.js"), "utf8");
  log("main app.js after approve", mainApp.trim());

  const st = run("git", ["status", "--porcelain"], repo);
  log("git status porcelain", st.stdout || "(clean)");

  if (useIndex) {
    const cached = run("git", ["diff", "--cached", "--stat"], repo);
    log("staged (index) stat", cached.stdout || "(nothing staged)");
  }

  const ok =
    out.ok &&
    mainApp.includes("v = 2") &&
    after?.status === "applied";

  log("SOAK RESULT", ok ? "PASS" : "FAIL");
  console.log(`\nTemp dir kept for inspection: ${base}`);
  console.log(`CLI equivalent:
  XCLAW_CONFIG_DIR=${cfgDir}  # if supported
  # or point config paths.configDir
  xclaw merge list
  xclaw merge approve ${proposal.id.slice(0, 8)} --repo ${repo}
`);

  process.exit(ok ? 0 : 1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
