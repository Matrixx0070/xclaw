/**
 * Swarm task-graph visualization helpers (ASCII waves, Mermaid).
 * Zero deps — safe for CLI / doctor / join summaries.
 */

/**
 * @typedef {object} GraphNode
 * @property {string} id
 * @property {string} [task]
 * @property {string} [role]
 * @property {string} [status]  pending|running|done|error|skipped|timeout
 * @property {string[]} [dependsOn]
 */

const STATUS_MARK = {
  pending: "·",
  running: "…",
  done: "✓",
  error: "✗",
  timeout: "⏱",
  skipped: "–",
};

/**
 * Topological levels (Kahn). Throws on cycle / missing dep.
 * @param {GraphNode[]} nodes
 * @returns {GraphNode[][]}
 */
export function topologicalWaves(nodes = []) {
  const byId = new Map();
  for (const n of nodes) {
    if (!n?.id) throw new Error("graph node missing id");
    if (byId.has(n.id)) throw new Error(`duplicate node id: ${n.id}`);
    byId.set(n.id, {
      ...n,
      dependsOn: [...new Set(n.dependsOn || [])],
    });
  }
  for (const n of byId.values()) {
    for (const d of n.dependsOn) {
      if (!byId.has(d)) throw new Error(`unknown dependsOn: ${d} (from ${n.id})`);
    }
  }

  const indeg = new Map();
  const children = new Map();
  for (const id of byId.keys()) {
    indeg.set(id, 0);
    children.set(id, []);
  }
  for (const n of byId.values()) {
    indeg.set(n.id, n.dependsOn.length);
    for (const d of n.dependsOn) {
      children.get(d).push(n.id);
    }
  }

  let ready = [...byId.values()].filter((n) => indeg.get(n.id) === 0);
  const waves = [];
  let seen = 0;

  while (ready.length) {
    waves.push(ready.map((n) => byId.get(n.id)));
    seen += ready.length;
    const next = [];
    for (const n of ready) {
      for (const c of children.get(n.id) || []) {
        indeg.set(c, indeg.get(c) - 1);
        if (indeg.get(c) === 0) next.push(byId.get(c));
      }
    }
    ready = next;
  }

  if (seen !== byId.size) {
    throw new Error("cycle detected in task graph");
  }
  return waves;
}

function shortLabel(n, max = 28) {
  const role = n.role || "task";
  const task = String(n.task || n.id).replace(/\s+/g, " ").trim();
  const body = task.length > max ? task.slice(0, max - 1) + "…" : task;
  return `${role}:${body}`;
}

function statusGlyph(status) {
  return STATUS_MARK[status] || STATUS_MARK.pending;
}

/**
 * ASCII wave diagram for CLI.
 *
 * Example output:
 *   Swarm graph (3 waves)
 *   wave 0  [✓ research: option A]  [✓ research: option B]
 *        └─ depends: (none)
 *   wave 1  [… implement: wire /health]
 *        └─ depends: r1, r2
 *   wave 2  [· verify: curl health]
 *        └─ depends: impl
 *
 * @param {GraphNode[]} nodes
 * @param {{ title?: string, width?: number }} [opts]
 */
export function toAsciiWaves(nodes = [], opts = {}) {
  const title = opts.title || "Swarm graph";
  if (!nodes.length) return `${title}\n  (empty)`;

  let waves;
  try {
    waves = topologicalWaves(nodes);
  } catch (e) {
    return `${title}\n  error: ${e.message}`;
  }

  const lines = [`${title} (${waves.length} wave${waves.length === 1 ? "" : "s"})`];

  waves.forEach((wave, wi) => {
    const cells = wave.map((n) => {
      const g = statusGlyph(n.status);
      return `[${g} ${shortLabel(n, opts.width ?? 28)}]`;
    });
    lines.push(`wave ${wi}  ${cells.join("  ")}`);

    const depSets = wave.map((n) =>
      (n.dependsOn || []).length ? (n.dependsOn || []).join(",") : "(none)"
    );
    const uniq = [...new Set(depSets)];
    if (uniq.length === 1) {
      lines.push(`       └─ depends: ${uniq[0]}`);
    } else {
      for (const n of wave) {
        const d = (n.dependsOn || []).length
          ? (n.dependsOn || []).join(",")
          : "(none)";
        lines.push(`       └─ ${n.id} depends: ${d}`);
      }
    }
  });

  lines.push("");
  lines.push("legend: · pending  … running  ✓ done  ✗ error  ⏱ timeout  – skipped");
  return lines.join("\n");
}

/**
 * Mermaid flowchart source (for Markdown / docs).
 * @param {GraphNode[]} nodes
 * @param {{ direction?: string }} [opts]
 */
export function toMermaid(nodes = [], opts = {}) {
  const dir = opts.direction || "LR";
  const lines = [`flowchart ${dir}`];
  const safe = (id) => String(id).replace(/[^a-zA-Z0-9_]/g, "_");

  for (const n of nodes) {
    const id = safe(n.id);
    const label = shortLabel(n, 40).replace(/"/g, "'");
    lines.push(`  ${id}["${label}"]`);
  }
  for (const n of nodes) {
    const id = safe(n.id);
    for (const d of n.dependsOn || []) {
      lines.push(`  ${safe(d)} --> ${id}`);
    }
  }

  // status classes
  const byStatus = {};
  for (const n of nodes) {
    const s = n.status || "pending";
    if (!byStatus[s]) byStatus[s] = [];
    byStatus[s].push(safe(n.id));
  }
  lines.push("  classDef pending fill:#e8e8e8,stroke:#999");
  lines.push("  classDef running fill:#f9e79f,stroke:#b7950b");
  lines.push("  classDef done fill:#abebc6,stroke:#1e8449");
  lines.push("  classDef error fill:#f5b7b1,stroke:#c0392b");
  lines.push("  classDef timeout fill:#fad7a0,stroke:#d68910");
  lines.push("  classDef skipped fill:#f5f5f5,stroke:#bbb,stroke-dasharray: 5 5");
  for (const [s, ids] of Object.entries(byStatus)) {
    if (ids.length) lines.push(`  class ${ids.join(",")} ${s}`);
  }
  return lines.join("\n");
}

/** DOT node id: must be a safe identifier (or quoted). */
export function escapeDotId(id) {
  const s = String(id ?? "");
  // Prefer bare identifier when possible
  if (/^[A-Za-z_][A-Za-z0-9_]*$/.test(s)) return s;
  // Quoted ID: escape \ and "
  return `"${s.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
}

/**
 * DOT label string (including quotes).
 * Escapes \, ", newlines; strips other control chars.
 */
export function escapeDotLabel(text) {
  const s = String(text ?? "")
    .replace(/\\/g, "\\\\")
    .replace(/"/g, '\\"')
    .replace(/\r\n/g, "\\n")
    .replace(/\n/g, "\\n")
    .replace(/\r/g, "\\n")
    .replace(/\t/g, " ")
    .replace(/[\u0000-\u001f\u007f]/g, "");
  return `"${s}"`;
}

const DOT_FILL = {
  pending: "#e8e8e8",
  running: "#f9e79f",
  done: "#abebc6",
  error: "#f5b7b1",
  timeout: "#fad7a0",
  skipped: "#f5f5f5",
};

/**
 * Graphviz DOT source for a task graph.
 * Node ids and edge endpoints are escaped; labels are quoted-escaped.
 *
 * @param {GraphNode[]} nodes
 * @param {{ rankdir?: string, title?: string }} [opts]
 */
export function toDot(nodes = [], opts = {}) {
  const rankdir = opts.rankdir || "LR";
  const lines = [];
  lines.push("digraph Swarm {");
  if (opts.title) {
    lines.push(`  label=${escapeDotLabel(opts.title)};`);
    lines.push(`  labelloc="t";`);
  }
  lines.push(`  rankdir=${rankdir};`);
  lines.push(`  node [shape=box, style=filled, fontname="Helvetica"];`);
  lines.push(`  edge [arrowsize=0.7];`);

  for (const n of nodes) {
    const id = escapeDotId(n.id);
    const label = escapeDotLabel(shortLabel(n, 40));
    const st = n.status || "pending";
    const fill = DOT_FILL[st] || DOT_FILL.pending;
    const extra =
      st === "skipped" ? `, style="filled,dashed"` : `, style=filled`;
    lines.push(
      `  ${id} [label=${label}, fillcolor=${escapeDotLabel(fill)}${extra}];`
    );
  }

  for (const n of nodes) {
    const to = escapeDotId(n.id);
    for (const d of n.dependsOn || []) {
      // Escape both endpoints (edges are the sensitive path for injection)
      const from = escapeDotId(d);
      // Optional per-edge or per-node edge label (e.g. policy / wave note)
      const edgeLabel = n.edgeLabels?.[d] ?? n.edgeLabel ?? null;
      if (edgeLabel != null && String(edgeLabel).length) {
        lines.push(
          `  ${from} -> ${to} [label=${escapeDotLabel(edgeLabel)}];`
        );
      } else {
        lines.push(`  ${from} -> ${to};`);
      }
    }
  }

  lines.push("}");
  return lines.join("\n");
}

/** Demo graph used in docs / CLI help */
export function examplePipelineGraph() {
  return [
    {
      id: "r1",
      role: "research",
      task: "option A notes",
      status: "done",
      dependsOn: [],
    },
    {
      id: "r2",
      role: "research",
      task: "option B notes",
      status: "done",
      dependsOn: [],
    },
    {
      id: "impl",
      role: "implement",
      task: "wire GET /health",
      status: "running",
      dependsOn: ["r1", "r2"],
    },
    {
      id: "verify",
      role: "verify",
      task: "curl /health",
      status: "pending",
      dependsOn: ["impl"],
    },
    {
      id: "critic",
      role: "critic",
      task: "review risks",
      status: "pending",
      dependsOn: ["verify"],
    },
  ];
}
