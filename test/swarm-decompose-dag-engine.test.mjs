/**
 * DAG Engine Tests — regression for the reversed in-degree topological sort
 * (any graph with a dependency edge used to sort incomplete → null groups →
 * orchestrator crash on null.length; found live 2026-08-24).
 */
import { describe, it } from "node:test";
import assert from "node:assert";
import { DAGEngine } from "../src/swarm/decompose/dag-engine.mjs";

const T = (taskId, dependencies = []) => ({ taskId, dependencies });

describe("DAGEngine", () => {
  it("sorts a fan-in graph completely (3 parallel + 1 join)", () => {
    const dag = new DAGEngine();
    const tasks = [T("a"), T("b"), T("c"), T("join", ["a", "b", "c"])];
    const sorted = dag.topologicalSort(dag.buildGraph(tasks));
    assert.ok(sorted, "sort must not be null");
    assert.strictEqual(sorted.length, 4);
    assert.strictEqual(sorted[3], "join");
  });

  it("builds execution groups honoring dependencies", () => {
    const dag = new DAGEngine();
    const tasks = [T("a"), T("b"), T("c"), T("join", ["a", "b", "c"])];
    const groups = dag.buildExecutionGroups(tasks);
    assert.ok(groups, "groups must not be null");
    assert.strictEqual(groups.length, 2);
    assert.deepStrictEqual([...groups[0].tasks].sort(), ["a", "b", "c"]);
    assert.strictEqual(groups[0].parallel, true);
    assert.deepStrictEqual(groups[1].tasks, ["join"]);
  });

  it("handles a diamond (a -> b,c -> d)", () => {
    const dag = new DAGEngine();
    const tasks = [T("a"), T("b", ["a"]), T("c", ["a"]), T("d", ["b", "c"])];
    const groups = dag.buildExecutionGroups(tasks);
    assert.ok(groups);
    assert.deepStrictEqual(groups.map((g) => [...g.tasks].sort()), [["a"], ["b", "c"], ["d"]]);
  });

  it("ignores phantom dependencies instead of deadlocking", () => {
    const dag = new DAGEngine();
    const tasks = [T("a", ["ghost-task"]), T("b", ["a"])];
    const groups = dag.buildExecutionGroups(tasks);
    assert.ok(groups, "phantom dep must not null the sort");
    assert.deepStrictEqual(groups.map((g) => g.tasks), [["a"], ["b"]]);
  });

  it("detects cycles and breaks them via fallback", async () => {
    const dag = new DAGEngine(); // no llm -> fallback path
    const tasks = [T("a", ["b"]), T("b", ["a"])];
    assert.strictEqual(dag.hasCycle(dag.buildGraph(tasks)), true);
    const { tasks: clean, breakingEdges } = await dag.detectAndBreakCycles(tasks);
    assert.ok(breakingEdges.length >= 1);
    const groups = dag.buildExecutionGroups(clean);
    assert.ok(groups, "post-break graph must sort");
  });
});
