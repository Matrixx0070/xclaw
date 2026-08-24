/**
 * Cycle Detector — Advanced cycle detection with resolution strategies
 * Used by DAG engine to ensure acyclic execution graphs
 */
export class CycleDetector {
  constructor() {
    this.detectedCycles = [];
  }

  // === TARJAN'S ALGORITHM (Strongly Connected Components) ===

  findCycles(tasks) {
    const graph = this._buildAdjacencyList(tasks);
    const cycles = [];
    const visited = new Set();
    const recStack = new Set();
    const path = [];

    const dfs = (nodeId) => {
      visited.add(nodeId);
      recStack.add(nodeId);
      path.push(nodeId);

      const neighbors = graph.get(nodeId) || [];
      for (const neighbor of neighbors) {
        if (!visited.has(neighbor)) {
          dfs(neighbor);
        } else if (recStack.has(neighbor)) {
          // Cycle found
          const cycleStart = path.indexOf(neighbor);
          const cycle = path.slice(cycleStart).concat([neighbor]);
          cycles.push(cycle);
        }
      }

      path.pop();
      recStack.delete(nodeId);
    };

    for (const taskId of graph.keys()) {
      if (!visited.has(taskId)) {
        dfs(taskId);
      }
    }

    this.detectedCycles = cycles;
    return cycles;
  }

  _buildAdjacencyList(tasks) {
    const graph = new Map();
    for (const task of tasks) {
      graph.set(task.taskId, task.dependencies || []);
    }
    return graph;
  }

  // === CYCLE RESOLUTION ===

  resolveCycles(tasks) {
    const cycles = this.findCycles(tasks);
    if (cycles.length === 0) return { resolved: true, tasks, changes: [] };

    const changes = [];
    const taskMap = new Map(tasks.map((t) => [t.taskId, t]));

    for (const cycle of cycles) {
      // Find the weakest edge to break (lowest priority or most recent)
      let weakestEdge = null;
      let weakestScore = Infinity;

      for (let i = 0; i < cycle.length - 1; i++) {
        const from = cycle[i];
        const to = cycle[i + 1];
        const fromTask = taskMap.get(from);

        if (fromTask) {
          const priority = fromTask.priority || 5;
          const score = priority * 100 + (fromTask.dependencies?.indexOf(to) || 0);

          if (score < weakestScore) {
            weakestScore = score;
            weakestEdge = { from, to };
          }
        }
      }

      if (weakestEdge) {
        const fromTask = taskMap.get(weakestEdge.from);
        if (fromTask) {
          fromTask.dependencies = fromTask.dependencies.filter(
            (d) => d !== weakestEdge.to
          );
          changes.push({
            type: "remove_edge",
            from: weakestEdge.from,
            to: weakestEdge.to,
            reason: "cycle_break",
            cycle: cycle,
          });
        }
      }
    }

    // Verify no cycles remain
    const remainingCycles = this.findCycles(tasks);
    return {
      resolved: remainingCycles.length === 0,
      tasks,
      changes,
      remainingCycles,
    };
  }

  // === DEPENDENCY VALIDATION ===

  validateDependencies(tasks) {
    const taskIds = new Set(tasks.map((t) => t.taskId));
    const errors = [];

    for (const task of tasks) {
      for (const dep of task.dependencies || []) {
        if (!taskIds.has(dep)) {
          errors.push({
            taskId: task.taskId,
            dependency: dep,
            error: "missing_dependency",
            message: `Task ${task.taskId} depends on non-existent task ${dep}`,
          });
        }
        if (dep === task.taskId) {
          errors.push({
            taskId: task.taskId,
            dependency: dep,
            error: "self_dependency",
            message: `Task ${task.taskId} depends on itself`,
          });
        }
      }
    }

    return { valid: errors.length === 0, errors };
  }

  // === TOPOLOGICAL LEVELS ===

  computeLevels(tasks) {
    const inDegree = new Map();
    const graph = this._buildAdjacencyList(tasks);

    for (const task of tasks) {
      inDegree.set(task.taskId, 0);
    }

    for (const [taskId, deps] of graph) {
      for (const dep of deps) {
        if (inDegree.has(dep)) {
          inDegree.set(dep, inDegree.get(dep) + 1);
        }
      }
    }

    const levels = new Map();
    let currentLevel = 0;
    let queue = tasks.filter((t) => inDegree.get(t.taskId) === 0).map((t) => t.taskId);

    while (queue.length > 0) {
      const nextQueue = [];
      for (const taskId of queue) {
        levels.set(taskId, currentLevel);
        const dependents = tasks.filter((t) => (t.dependencies || []).includes(taskId));
        for (const dependent of dependents) {
          const newDegree = inDegree.get(dependent.taskId) - 1;
          inDegree.set(dependent.taskId, newDegree);
          if (newDegree === 0) {
            nextQueue.push(dependent.taskId);
          }
        }
      }
      queue = nextQueue;
      currentLevel++;
    }

    return levels;
  }
}
