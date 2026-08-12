/**
 * S5 — CLI for swarm runs and merge proposals (no agent loop required).
 */
import { listSwarmRuns, getSwarmRun } from "../agents/swarm-store.mjs";
import { resumeSwarmRun } from "../agents/swarm-run.mjs";
import {
  listMergeProposals,
  getMergeProposal,
  approveMergeProposal,
  rejectMergeProposal,
  resolveMergePolicy,
  diagnoseMergeProposal,
} from "../agents/swarm-merge.mjs";
import { toAsciiWaves } from "../agents/graph-viz.mjs";

function flag(args, name) {
  const i = args.indexOf(name);
  if (i === -1) return null;
  return args[i + 1] ?? true;
}

function has(args, name) {
  return args.includes(name);
}

/**
 * xclaw swarm …
 */
export async function swarmCliMain(cfg, args = []) {
  const sub = args[0] || "status";

  if (sub === "help" || sub === "-h" || sub === "--help") {
    printSwarmHelp();
    return 0;
  }

  if (sub === "status" || sub === "list") {
    const limit = Number(flag(args, "--limit") || 15);
    const runs = await listSwarmRuns(cfg, { limit });
    if (has(args, "--json")) {
      console.log(JSON.stringify({ count: runs.length, runs }, null, 2));
      return 0;
    }
    if (!runs.length) {
      console.log("No swarm runs found under ~/.xclaw/swarms/runs/");
      return 0;
    }
    console.log("Swarm runs (newest first)\n");
    for (const r of runs) {
      const id = String(r.id || "").slice(0, 8);
      const st = r.status || "?";
      const goal = String(r.goal || "").slice(0, 50);
      const merge = r.merge?.status ? ` merge=${r.merge.status}` : "";
      console.log(`  ${id}  ${st.padEnd(10)}  ${goal}${merge}`);
    }
    console.log(`\nDetail: xclaw swarm show <id>`);
    return 0;
  }

  if (sub === "resume") {
    const id = args[1] || flag(args, "--id");
    if (!id) {
      console.error("Usage: xclaw swarm resume <swarmId>");
      return 1;
    }
    const rec = (await getSwarmRun(cfg, id)) || (await findRunByPrefix(cfg, id));
    if (!rec) {
      console.error("Swarm run not found:", id);
      return 1;
    }
    console.log(`Resuming swarm ${rec.id} (${rec.status}) …`);
    const out = await resumeSwarmRun(cfg, rec.id, {
      workingDir: process.cwd(),
      onEvent: (e) => {
        if (e?.phase && e.type === "swarm") {
          console.log(`  [${e.phase}] ${e.nodeId || ""}`.trimEnd());
        }
      },
    });
    if (!out.ok && out.error) {
      console.error(`Resume failed (${out.code || "ERROR"}): ${out.error}`);
      return 1;
    }
    console.log(out.summary || `status=${out.status}`);
    return out.ok ? 0 : 1;
  }

  if (sub === "show" || sub === "get") {
    const id = args[1] || flag(args, "--id");
    if (!id) {
      console.error("Usage: xclaw swarm show <swarmId>");
      return 1;
    }
    const rec = await getSwarmRun(cfg, id) || (await findRunByPrefix(cfg, id));
    if (!rec) {
      console.error("Swarm run not found:", id);
      return 1;
    }
    if (has(args, "--json")) {
      console.log(JSON.stringify(rec, null, 2));
      return 0;
    }
    console.log(`Swarm ${rec.id}`);
    console.log(`  status:  ${rec.status}`);
    console.log(`  goal:    ${rec.goal || "—"}`);
    console.log(`  created: ${rec.createdAt || "—"}`);
    console.log(`  finished:${rec.finishedAt || "—"}`);
    if (rec.merge) {
      console.log(
        `  merge:   ${rec.merge.status || "—"}  proposal=${rec.merge.proposalId || "—"}`
      );
    }
    if (rec.graph?.length) {
      try {
        const ascii = toAsciiWaves(
          rec.graph.map((n) => ({
            id: n.id,
            role: n.role,
            task: n.task,
            dependsOn: n.dependsOn || [],
            status: n.status,
          })),
          { title: `Swarm ${String(rec.id).slice(0, 8)}` }
        );
        console.log("\n" + ascii);
      } catch {
        console.log("\nGraph nodes:", rec.graph.length);
      }
    }
    if (rec.summary && has(args, "--summary")) {
      console.log("\n--- summary ---\n");
      console.log(String(rec.summary).slice(0, 8000));
    } else if (rec.summary) {
      console.log("\n(use --summary to print join summary)");
    }
    return 0;
  }

  if (sub === "policy") {
    const p = resolveMergePolicy(cfg);
    console.log(JSON.stringify({ swarm: cfg.swarm || {}, mergePolicy: p }, null, 2));
    return 0;
  }

  printSwarmHelp();
  return 1;
}

/**
 * xclaw merge …
 */
export async function mergeCliMain(cfg, args = []) {
  const sub = args[0] || "list";

  if (sub === "help" || sub === "-h" || sub === "--help") {
    printMergeHelp();
    return 0;
  }

  if (sub === "list" || sub === "status") {
    const status = flag(args, "--status") || "pending";
    const limit = Number(flag(args, "--limit") || 20);
    const list = await listMergeProposals(cfg, {
      status: status === "all" ? undefined : status,
      limit,
    });
    if (has(args, "--json")) {
      console.log(JSON.stringify({ count: list.length, proposals: list }, null, 2));
      return 0;
    }
    if (!list.length) {
      console.log(`No merge proposals (filter status=${status}).`);
      return 0;
    }
    console.log(`Merge proposals (status=${status})\n`);
    for (const p of list) {
      const id = String(p.id || "").slice(0, 8);
      console.log(
        `  ${id}  ${String(p.status).padEnd(10)}  swarm=${String(p.swarmId || "—").slice(0, 8)}  items=${(p.items || []).length}`
      );
    }
    console.log(`\nApprove: xclaw merge approve <proposalId>`);
    return 0;
  }

  if (sub === "show" || sub === "get") {
    const id = args[1];
    if (!id) {
      console.error("Usage: xclaw merge show <proposalId>");
      return 1;
    }
    const rec =
      (await getMergeProposal(cfg, id)) ||
      (await findProposalByPrefix(cfg, id));
    if (!rec) {
      console.error("Proposal not found:", id);
      return 1;
    }
    console.log(JSON.stringify(rec, null, 2));
    return 0;
  }

  if (sub === "doctor" || sub === "diagnose") {
    const id = args[1];
    if (!id) {
      console.error("Usage: xclaw merge doctor <proposalId> [--repo PATH]");
      return 1;
    }
    const full =
      (await getMergeProposal(cfg, id)) ||
      (await findProposalByPrefix(cfg, id));
    if (!full) {
      const diag = await diagnoseMergeProposal(cfg, id, {
        repoDir: flag(args, "--repo") || process.cwd(),
      });
      console.log(JSON.stringify(diag, null, 2));
      return 1;
    }
    const diag = await diagnoseMergeProposal(cfg, full.id, {
      repoDir: flag(args, "--repo") || full.repoDir || process.cwd(),
    });
    console.log(JSON.stringify(diag, null, 2));
    if (!diag.ok && diag.hints?.length) {
      console.error("\nHints:");
      for (const h of diag.hints) console.error("  -", h);
    }
    return diag.ok ? 0 : 1;
  }

  if (sub === "approve") {
    const id = args[1];
    if (!id) {
      console.error(
        "Usage: xclaw merge approve <proposalId> [--cleanup] [--repo PATH]"
      );
      return 1;
    }
    const full =
      (await getMergeProposal(cfg, id)) ||
      (await findProposalByPrefix(cfg, id));
    if (!full) {
      console.error("Proposal not found:", id);
      console.error("Try: xclaw merge list --status all");
      console.error("     xclaw merge doctor", id);
      return 1;
    }
    const repoDir = flag(args, "--repo") || full.repoDir || process.cwd();
    const out = await approveMergeProposal(cfg, full.id, {
      cleanupWorktree: has(args, "--cleanup"),
      repoDir,
      commit: has(args, "--commit") || has(args, "--commit-trailers"),
      commitSubject: flag(args, "--message") || flag(args, "-m") || undefined,
    });
    console.log(JSON.stringify(out, null, 2));
    if (out.commit?.ok && out.commit.sha) {
      console.error("Committed", out.commit.sha.slice(0, 8), "with XClaw trailers");
    }
    if (!out.ok) {
      console.error("\nApprove failed. Diagnose with:");
      console.error(
        `  xclaw merge doctor ${full.id.slice(0, 8)} --repo ${repoDir}`
      );
      if (out.code === "REPO_MISSING" || out.code === "REPO_NOT_DIRECTORY") {
        console.error("  Repo path missing — pass a real git root:");
        console.error(
          "  xclaw merge approve",
          full.id.slice(0, 8),
          "--repo /path/to/repo"
        );
        if (out.tried?.length) {
          console.error("  Tried:", out.tried.join(", "));
        }
      }
      if (out.code === "MAIN_NOT_GIT") {
        console.error(
          "  Path is not a git repository:",
          out.repoDir || repoDir
        );
      }
      if (out.code === "MAIN_DIRTY") {
        console.error("  git -C", out.repoDir || repoDir, "status");
        console.error("  git -C", out.repoDir || repoDir, "stash -u");
      }
      if (out.failed?.some((f) => f.code === "WORKTREE_GONE")) {
        console.error("  Worktree path gone — re-run implement swarm node");
      }
      if (out.failed?.some((f) => f.code === "PATCH_CHECK_FAILED")) {
        console.error(
          "  Patch no longer applies — main drifted; inspect patchPath in JSON"
        );
      }
    }
    return out.ok ? 0 : 1;
  }

  if (sub === "reject") {
    const id = args[1];
    if (!id) {
      console.error("Usage: xclaw merge reject <proposalId> [reason]");
      return 1;
    }
    const full =
      (await getMergeProposal(cfg, id)) ||
      (await findProposalByPrefix(cfg, id));
    if (!full) {
      console.error("Proposal not found:", id);
      return 1;
    }
    const reason = args.slice(2).join(" ") || "";
    const out = await rejectMergeProposal(cfg, full.id, reason);
    console.log(JSON.stringify(out, null, 2));
    return out.ok ? 0 : 1;
  }

  printMergeHelp();
  return 1;
}

async function findRunByPrefix(cfg, prefix) {
  const runs = await listSwarmRuns(cfg, { limit: 50 });
  const matches = runs.filter((r) => String(r.id).startsWith(prefix));
  return matches.length === 1 ? matches[0] : null;
}

async function findProposalByPrefix(cfg, prefix) {
  const list = await listMergeProposals(cfg, { status: undefined, limit: 50 });
  const matches = list.filter((p) => String(p.id).startsWith(prefix));
  return matches.length === 1 ? matches[0] : null;
}

function printSwarmHelp() {
  console.log(`Usage:
  xclaw swarm status|--list [--json] [--limit N]
  xclaw swarm show <id> [--json] [--summary]
  xclaw swarm resume <id>       re-run an interrupted run from its journal
  xclaw swarm policy

Shows durable SwarmRun records under ~/.xclaw/swarms/runs/`);
}

function printMergeHelp() {
  console.log(`Usage:
  xclaw merge list [--status pending|all] [--json]
  xclaw merge show <proposalId>
  xclaw merge doctor <proposalId> [--repo PATH]
  xclaw merge approve <proposalId> [--cleanup] [--repo PATH] [--commit] [-m msg]
  xclaw merge reject <proposalId> [reason]

Proposals: ~/.xclaw/swarms/merge-proposals/
On approve failure: xclaw merge doctor <id> --repo <main-repo>`);
}
