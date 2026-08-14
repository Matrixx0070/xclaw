/**
 * Live execution canvas (Mandate-2 slice B5) — zero-dep hand-rolled SVG.
 *
 * Renders a swarm run's task graph as columns-by-wave, patches node status
 * in place from `swarm` WS events (no refetch-per-event), keeps a ring
 * buffer of recent events per node (click a node for its tail), and runs a
 * cost ticker from `tokens` usage events.
 *
 * Public surface (window.XClawCanvas):
 *   showRun(runRecord)  — render the DAG for a fetched /swarm/:id record
 *   onWsEvent(evt)      — feed every swarm-channel WS event
 */
(function () {
  const STATUS_COLOR = {
    pending: "#8a8f98",
    running: "#3b82f6",
    retry: "#f59e0b",
    ok: "#22c55e",
    done: "#22c55e",
    failed: "#ef4444",
    skipped: "#6b7280",
  };
  const RING_MAX = 200;

  let currentRun = null; // { id, nodes: Map<nodeId, {el, status, deps}> }
  const rings = new Map(); // key (nodeId|subagentId) -> [events]
  const subToNode = new Map(); // subagentId -> nodeId
  let costUsd = 0;
  let selectedNode = null;

  function el(id) {
    return document.getElementById(id);
  }

  function topoWaves(nodes) {
    const byId = new Map(nodes.map((n) => [n.id, n]));
    const wave = new Map();
    const visit = (n, stack = new Set()) => {
      if (wave.has(n.id)) return wave.get(n.id);
      if (stack.has(n.id)) return 0; // cycle safety — server validates anyway
      stack.add(n.id);
      const deps = (n.dependsOn || []).map((d) => byId.get(d)).filter(Boolean);
      const w = deps.length ? Math.max(...deps.map((d) => visit(d, stack))) + 1 : 0;
      wave.set(n.id, w);
      return w;
    };
    nodes.forEach((n) => visit(n));
    return wave;
  }

  function ringKey(evt) {
    return evt.nodeId || subToNode.get(evt.subagentId) || evt.subagentId || "_run";
  }

  function pushRing(evt) {
    const key = ringKey(evt);
    if (!rings.has(key)) rings.set(key, []);
    const r = rings.get(key);
    r.push(evt);
    if (r.length > RING_MAX) r.shift();
    if (selectedNode && key === selectedNode) renderTail(key);
  }

  function renderTail(nodeId) {
    const out = el("swarmNodeTail");
    if (!out) return;
    const r = rings.get(nodeId) || [];
    out.style.display = "block";
    out.textContent =
      `── node ${nodeId} (last ${r.length} events) ──\n` +
      r
        .slice(-60)
        .map((e) => {
          const t = e.type || "?";
          const p = e.phase || "";
          if (t === "tool") return `tool ${p} ${e.name || ""} ${e.preview ? "· " + String(e.preview).slice(0, 80) : ""}`;
          if (t === "swarm") return `swarm ${p} ${e.nodeId || ""} ${e.ok === false ? "FAIL" : ""} ${e.attempt ? "attempt " + e.attempt : ""}`;
          if (t === "tokens") return `tokens turn ${e.turn} $${(e.costUsd || 0).toFixed(5)}`;
          if (t === "security") return `security ${p} ${e.name || ""} ${e.riskTier ? "[" + e.riskTier + "]" : ""}`;
          return `${t} ${p}`;
        })
        .join("\n");
  }

  function setNodeStatus(nodeId, status) {
    const rec = currentRun?.nodes?.get(nodeId);
    if (!rec) return;
    rec.status = status;
    const color = STATUS_COLOR[status] || STATUS_COLOR.pending;
    rec.rect.setAttribute("fill", color + "22");
    rec.rect.setAttribute("stroke", color);
    rec.dot.setAttribute("fill", color);
    rec.label2.textContent = status;
  }

  function showRun(run) {
    const host = el("swarmCanvas");
    if (!host || !run) return;
    const nodes = (run.graph || run.nodes || []).map((n) => ({
      id: n.id,
      role: n.role || "research",
      status: n.status || "pending",
      dependsOn: n.dependsOn || [],
    }));
    if (!nodes.length) {
      host.innerHTML = "<div style='opacity:.6;padding:8px'>no task graph on this run</div>";
      return;
    }
    currentRun = { id: run.id, nodes: new Map() };
    rings.clear();
    subToNode.clear();
    selectedNode = null;

    const waves = topoWaves(nodes);
    const cols = new Map();
    nodes.forEach((n) => {
      const w = waves.get(n.id) || 0;
      if (!cols.has(w)) cols.set(w, []);
      cols.get(w).push(n);
    });
    const W = 168, H = 54, GX = 70, GY = 18, PAD = 14;
    const nCols = cols.size;
    const maxRows = Math.max(...[...cols.values()].map((c) => c.length));
    const width = PAD * 2 + nCols * W + (nCols - 1) * GX;
    const height = PAD * 2 + maxRows * H + (maxRows - 1) * GY;
    const NS = "http://www.w3.org/2000/svg";
    const svg = document.createElementNS(NS, "svg");
    svg.setAttribute("viewBox", `0 0 ${width} ${height}`);
    svg.setAttribute("width", "100%");
    svg.style.maxHeight = "340px";

    const pos = new Map();
    [...cols.keys()].sort((a, b) => a - b).forEach((w, ci) => {
      cols.get(w).forEach((n, ri) => {
        pos.set(n.id, { x: PAD + ci * (W + GX), y: PAD + ri * (H + GY) });
      });
    });

    // edges first (under nodes)
    for (const n of nodes) {
      for (const dep of n.dependsOn) {
        const a = pos.get(dep), b = pos.get(n.id);
        if (!a || !b) continue;
        const p = document.createElementNS(NS, "path");
        const x1 = a.x + W, y1 = a.y + H / 2, x2 = b.x, y2 = b.y + H / 2;
        p.setAttribute("d", `M ${x1} ${y1} C ${x1 + GX / 2} ${y1}, ${x2 - GX / 2} ${y2}, ${x2} ${y2}`);
        p.setAttribute("fill", "none");
        p.setAttribute("stroke", "#8a8f9866");
        p.setAttribute("stroke-width", "1.5");
        svg.appendChild(p);
      }
    }

    for (const n of nodes) {
      const { x, y } = pos.get(n.id);
      const g = document.createElementNS(NS, "g");
      g.style.cursor = "pointer";
      const rect = document.createElementNS(NS, "rect");
      rect.setAttribute("x", x); rect.setAttribute("y", y);
      rect.setAttribute("width", W); rect.setAttribute("height", H);
      rect.setAttribute("rx", 8);
      const dot = document.createElementNS(NS, "circle");
      dot.setAttribute("cx", x + 14); dot.setAttribute("cy", y + 16); dot.setAttribute("r", 4);
      const label = document.createElementNS(NS, "text");
      label.setAttribute("x", x + 26); label.setAttribute("y", y + 20);
      label.setAttribute("font-size", "12");
      label.setAttribute("fill", "currentColor");
      label.textContent = `${n.id} · ${n.role}`;
      const label2 = document.createElementNS(NS, "text");
      label2.setAttribute("x", x + 14); label2.setAttribute("y", y + 40);
      label2.setAttribute("font-size", "11");
      label2.setAttribute("fill", "currentColor");
      label2.setAttribute("opacity", "0.75");
      label2.textContent = n.status;
      g.append(rect, dot, label, label2);
      g.addEventListener("click", () => {
        selectedNode = n.id;
        renderTail(n.id);
      });
      svg.appendChild(g);
      currentRun.nodes.set(n.id, { rect, dot, label2, status: n.status });
      setNodeStatus(n.id, n.status);
    }

    host.innerHTML = "";
    host.appendChild(svg);
    const ticker = el("swarmCostTicker");
    if (ticker) { costUsd = 0; ticker.textContent = "$0.00000"; }
  }

  function onWsEvent(evt) {
    if (!evt) return;
    // node↔subagent pairing for tail bucketing
    if (evt.subagentId && evt.nodeId) subToNode.set(evt.subagentId, evt.nodeId);
    pushRing(evt);

    if (evt.type === "tokens" && typeof evt.costUsd === "number") {
      costUsd += evt.costUsd;
      const ticker = el("swarmCostTicker");
      if (ticker) ticker.textContent = `$${costUsd.toFixed(5)}`;
    }
    if (!currentRun || (evt.swarmId && evt.swarmId !== currentRun.id)) return;
    if (evt.type !== "swarm") return;
    const { phase, nodeId } = evt;
    if (phase === "child_start" && nodeId) setNodeStatus(nodeId, "running");
    else if (phase === "child_retry" && nodeId) setNodeStatus(nodeId, "retry");
    else if (phase === "child_done" && nodeId) setNodeStatus(nodeId, evt.ok === false ? "failed" : "ok");
    else if (phase === "child_skip" && nodeId) setNodeStatus(nodeId, "skipped");
  }

  window.XClawCanvas = { showRun, onWsEvent };
})();
