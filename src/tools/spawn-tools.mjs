/**
 * xclaw_spawn_agent — let the agent delegate a slice of work to a subagent.
 *
 * Before this, `/subagents` and swarm were operator-initiated only: the agent
 * had file, shell and skill tools and no way to delegate. Asked to run three
 * independent audits concurrently it ran three sequential shell calls and then
 * reported "ran the three jobs at the same time (three parallel shells)" —
 * overclaiming parallelism it could not achieve.
 *
 * The agent loop already batches independent tool calls (maxParallel), so
 * emitting several spawn calls in one turn runs the children concurrently.
 *
 * Guards, all failing closed with a structured refusal rather than a throw:
 *   - depth   — spawnSubagent refuses past cfg.swarm.maxSpawnDepth (default 2)
 *   - fan-out — cfg.swarm.maxChildrenPerRun (default 4) per parent run
 *   - turns   — a child's maxTurns is clamped so a delegate cannot outrun its parent
 */
import { spawnSubagent } from "../agents/spawn.mjs";

const DEFAULT_MAX_CHILDREN = 4;
const DEFAULT_CHILD_TURNS = 6;

function textResult(text, extra = {}) {
  return { content: [{ type: "text", text: String(text ?? "") }], ...extra };
}

function errorResult(msg, extra = {}) {
  return { isError: true, content: [{ type: "text", text: String(msg) }], ...extra };
}

export function maxChildrenPerRun(cfg = {}) {
  const n = Number(cfg?.swarm?.maxChildrenPerRun ?? DEFAULT_MAX_CHILDREN);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : DEFAULT_MAX_CHILDREN;
}

/** Clamp a requested child turn budget into something a delegate cannot abuse. */
export function childTurns(requested, cfg = {}) {
  const ceiling = Math.max(
    1,
    Number(cfg?.swarm?.maxChildTurns ?? cfg?.agent?.maxTurns ?? DEFAULT_CHILD_TURNS) ||
      DEFAULT_CHILD_TURNS
  );
  const want = Number(requested);
  if (!Number.isFinite(want) || want <= 0) return Math.min(DEFAULT_CHILD_TURNS, ceiling);
  return Math.min(Math.floor(want), ceiling);
}

export function createSpawnTools({ workingDir, cfg, runState } = {}) {
  const conf = cfg || {};
  const wd = workingDir || process.cwd();
  // per-parent-run counter; the loop builds tools once per run
  const state = runState || { spawned: 0 };

  return [
    {
      name: "xclaw_spawn_agent",
      description:
        "Delegate one independent slice of work to a subagent that runs on its own. " +
        "Call it several times in the same turn and those slices run concurrently. " +
        "You decide whether to delegate and how many to spawn — nobody has to ask you to. " +
        "\n\nIt pays off when a slice is SLOW (roughly 10s or more of work), when slices " +
        "are genuinely INDEPENDENT of each other, or when a slice needs its own workspace. " +
        "Two or three slices is the usual shape; more than that rarely helps. " +
        "\n\nIt does NOT pay off for quick commands: a child costs ~10-30s to start, so " +
        "several fast checks belong in one shell call instead. Do not delegate work whose " +
        "output the next slice depends on — that is sequential by nature. " +
        "\n\nEach child is blind to this conversation, so the task must be self-contained. " +
        "It returns its own result and you combine them. Never describe work as parallel " +
        "unless you actually spawned it.",
      parameters: {
        type: "object",
        properties: {
          task: {
            type: "string",
            description:
              "Self-contained instruction for the child. It does not see this conversation, so say everything it needs.",
          },
          maxTurns: {
            type: "number",
            description: `Optional turn budget for the child (clamped, default ${DEFAULT_CHILD_TURNS}).`,
          },
        },
        required: ["task"],
      },
      isReadOnly: () => false,
      async execute(args = {}) {
        const task = String(args.task || "").trim();
        if (!task) return errorResult("task is required — say what the child should do");

        const limit = maxChildrenPerRun(conf);
        if (state.spawned >= limit) {
          return errorResult(
            `spawn limit reached: ${state.spawned}/${limit} children this run ` +
              `(raise swarm.maxChildrenPerRun to allow more). Do the rest inline.`,
            { code: "SPAWN_FANOUT_EXCEEDED", spawned: state.spawned, limit }
          );
        }
        state.spawned += 1;

        let out;
        try {
          out = await spawnSubagent({
            task,
            maxTurns: childTurns(args.maxTurns, conf),
            cfg: conf,
            workingDir: wd,
          });
        } catch (err) {
          return errorResult(`spawn failed: ${err?.message || err}`, { code: "SPAWN_ERROR" });
        }

        if (!out?.ok) {
          return errorResult(
            `subagent refused: ${out?.error || out?.code || "unknown"}`,
            { code: out?.code || "SPAWN_REFUSED", subagent: out?.id || null }
          );
        }
        const body = String(out.result?.text ?? out.result ?? "").trim();
        return textResult(body || "(child returned no text)", {
          subagent: { id: out.id, status: out.status ?? "done", turns: out.result?.turns ?? null },
        });
      },
    },
  ];
}

export default { createSpawnTools, maxChildrenPerRun, childTurns };
