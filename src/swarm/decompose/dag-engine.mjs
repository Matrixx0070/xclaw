/**
 * DAG Engine — Directed Acyclic Graph execution engine
 * Handles dependency resolution, topological sorting, cycle detection
 * Supports execution groups for parallel/sequential batching
 */
import { formatCycleDetectionPrompt } from "./prompts.mjs";

export class DAGEngine {
  constructor(llmClient = null) {
    this.llm = llmClient;
    this.graphs = new Map(); // taskId -> DAG
  }

  // === GRAPH CONSTRUCTION ===

  buildGraph(tasks) {
    const nodes = new Map();
    const edges = new Map();

    for (const task of tasks) {
      nodes.set(task.taskId, { ...task, status: "pending", depth: 0 });
      edges.set(task.taskId, new Set(task.dependencies || []));
    }

    return { nodes, edges, taskIds: tasks.map((t) => t.taskId) };
  }

  // === CYCLE DETECTION ===

  hasCycle(graph) {
    const visited = new Set();
    const recStack = new Set();

    const dfs = (nodeId) => {
      visited.add(nodeId);
      recStack.add(nodeId);

      const neighbors = graph.edges.get(nodeId) || new Set();
      for (const neighbor of neighbors) {
        if (!visited.has(neighbor)) {
          if (dfs(neighbor)) return true;
        } else if (recStack.has(neighbor)) {
          return true;
        }
      }

      recStack.delete(nodeId);
      return false;
    };

    for (const nodeId of graph.nodes.keys()) {
      if (!visited.has(nodeId)) {
        if (dfs(nodeId)) return true;
      }
    }

    return false;
  }

  async detectAndBreakCycles(tasks) {
    const graph = this.buildGraph(tasks);

    if (!this.hasCycle(graph)) {
      return { hasCycle: false, tasks, breakingEdges: [] };
    }

    // Use LLM to detect and suggest breaking edges
    if (this.llm) {
      try {
        const messages = formatCycleDetectionPrompt(tasks);
        const response = await this.llm.structuredOutput(messages, {
          type: "object",
          properties: {
            hasCycle: { type: "boolean" },
            cycles: { type: "array", items: { type: "array", items: { type: "string" } } },
            breakingEdges: { type: "array", items: { type: "object" } },
            topologicalOrder: { type: "array", items: { type: "string" } },
          },
        });

        if (response.breakingEdges) {
          for (const edge of response.breakingEdges) {
            const task = tasks.find((t) => t.taskId === edge.from);
            if (task) {
              task.dependencies = task.dependencies.filter((d) => d !== edge.to);
            }
          }
        }

        return { hasCycle: true, tasks, breakingEdges: response.breakingEdges || [] };
      } catch (e) {
        console.warn("[swarm-dag] LLM cycle detection failed, using fallback:", e.message);
      }
    }

    // Fallback: break cycles by removing lowest-priority dependency
    const breakingEdges = [];
    for (const task of tasks) {
      if (task.dependencies) {
        const toRemove = [];
        for (const dep of task.dependencies) {
          // Check if this dependency creates a cycle
          if (this._wouldCreateCycle(tasks, task.taskId, dep)) {
            toRemove.push(dep);
            breakingEdges.push({ from: task.taskId, to: dep, reason: "cycle break" });
          }
        }
        task.dependencies = task.dependencies.filter((d) => !toRemove.includes(d));
      }
    }

    return { hasCycle: true, tasks, breakingEdges };
  }

  _wouldCreateCycle(tasks, fromId, toId) {
    // Check if adding edge from->to creates a cycle by checking if to can reach from
    const visited = new Set();
    const queue = [toId];
    while (queue.length > 0) {
      const current = queue.shift();
      if (current === fromId) return true;
      if (visited.has(current)) continue;
      visited.add(current);

      const task = tasks.find((t) => t.taskId === current);
      if (task && task.dependencies) {
        for (const dep of task.dependencies) {
          if (!visited.has(dep)) queue.push(dep);
        }
      }
    }
    return false;
  }

  // === TOPOLOGICAL SORT ===

  topologicalSort(graph) {
    // Vendor bug: this initialized in-degree by incrementing each DEPENDENCY's
    // counter instead of the dependent node's — so any graph with at least one
    // dependency edge sorted incomplete and buildExecutionGroups returned null
    // (orchestrator then crashed on null.length). in-degree(node) = number of
    // its own dependencies that exist in the graph (unknown ids are ignored so
    // a phantom dep can never deadlock the sort).
    const inDegree = new Map();
    for (const [nodeId, deps] of graph.edges) {
      let d = 0;
      for (const dep of deps) {
        if (graph.nodes.has(dep)) d++;
      }
      inDegree.set(nodeId, d);
    }

    const queue = [];
    for (const [nodeId, degree] of inDegree) {
      if (degree === 0) queue.push(nodeId);
    }

    const result = [];
    const queued = new Set(queue);
    while (queue.length > 0) {
      const current = queue.shift();
      result.push(current);

      // Find nodes that depend on current
      for (const [nodeId, deps] of graph.edges) {
        if (deps.has(current)) {
          inDegree.set(nodeId, inDegree.get(nodeId) - 1);
          if (inDegree.get(nodeId) === 0 && !queued.has(nodeId)) {
            queued.add(nodeId);
            queue.push(nodeId);
          }
        }
      }
    }

    return result.length === graph.nodes.size ? result : null;
  }

  // === EXECUTION GROUPS ===

  buildExecutionGroups(tasks) {
    const graph = this.buildGraph(tasks);
    const sorted = this.topologicalSort(graph);
    if (!sorted) return null;

    const groups = [];
    const completed = new Set();

    while (completed.size < sorted.length) {
      // Find all tasks whose dependencies are satisfied
      const ready = [];
      for (const taskId of sorted) {
        if (completed.has(taskId)) continue;
        const task = graph.nodes.get(taskId);
        // A dependency on a task that does not exist in the graph can never
        // complete — ignore it (mirrors the phantom-dep handling in
        // topologicalSort; otherwise one hallucinated dep id stalls the plan).
        const depsSatisfied = (task.dependencies || []).every(
          (d) => completed.has(d) || !graph.nodes.has(d)
        );
        if (depsSatisfied) {
          ready.push(taskId);
        }
      }

      if (ready.length === 0) break; // Should not happen if no cycles

      groups.push({
        groupId: `group_${groups.length + 1}`,
        tasks: ready,
        parallel: ready.length > 1,
      });

      for (const taskId of ready) {
        completed.add(taskId);
      }
    }

    return groups;
  }

  // === EXECUTION ===

  async executeWithDependencies(tasks, executeFn) {
    const { tasks: cleanTasks } = await this.detectAndBreakCycles(tasks);
    const groups = this.buildExecutionGroups(cleanTasks);

    if (!groups) {
      throw new Error("Could not build execution groups — possible unresolvable cycles");
    }

    const results = new Map();

    for (const group of groups) {
      console.log(`[swarm-dag] Executing group ${group.groupId} (${group.tasks.length} tasks, parallel: ${group.parallel})`);

      const groupTasks = cleanTasks.filter((t) => group.tasks.includes(t.taskId));

      if (group.parallel) {
        // Execute in parallel
        const groupResults = await Promise.all(
          groupTasks.map(async (task) => {
            try {
              const result = await executeFn(task);
              results.set(task.taskId, result);
              return result;
            } catch (e) {
              results.set(task.taskId, { error: e.message, taskId: task.taskId });
              return { error: e.message, taskId: task.taskId };
            }
          })
        );
      } else {
        // Execute sequentially
        for (const task of groupTasks) {
          try {
            const result = await executeFn(task);
            results.set(task.taskId, result);
          } catch (e) {
            results.set(task.taskId, { error: e.message, taskId: task.taskId });
          }
        }
      }
    }

    return { results, groups, cleanTasks };
  }

  // === PROGRESS TRACKING ===

  getExecutionProgress(graph, completedTasks) {
    const total = graph.nodes.size;
    const completed = completedTasks.size;
    const pending = total - completed;

    // Find currently running tasks (in current group but not completed)
    const running = [];
    for (const [taskId, task] of graph.nodes) {
      if (!completedTasks.has(taskId)) {
        const depsSatisfied = (task.dependencies || []).every((d) => completedTasks.has(d));
        if (depsSatisfied) {
          running.push(taskId);
        }
      }
    }

    return {
      total,
      completed,
      pending,
      running: running.length,
      runningTasks: running,
      percentComplete: Math.round((completed / total) * 100),
    };
  }
}
