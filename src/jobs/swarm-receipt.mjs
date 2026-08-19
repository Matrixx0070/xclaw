/**
 * Swarm parent job receipt aggregator (scaffold).
 */
export function createSwarmReceipt(parentId) {
  return {
    parentId,
    children: [],
    totalUsd: 0,
    hardBlocks: 0,
    toolHashTips: [],
    at: new Date().toISOString(),
  };
}

export function attachChildReceipt(swarm, child = {}) {
  if (!swarm || typeof swarm !== "object") return swarm;
  swarm.children = swarm.children || [];
  swarm.children.push({
    id: child.id || null,
    status: child.status || null,
    pass: child.pass ?? null,
    usd: Number(child.usd || child.spentUsd || 0) || 0,
    hardBlocks: Number(child.quotaEscalate?.hardBlocks || child.hardBlocks || 0) || 0,
    toolHashTip: child.toolHashTip || null,
    quotaHardCircuit: child.quotaHardCircuit || null,
  });
  swarm.totalUsd = swarm.children.reduce((s, c) => s + (Number(c.usd) || 0), 0);
  swarm.hardBlocks = swarm.children.reduce((s, c) => s + (Number(c.hardBlocks) || 0), 0);
  swarm.toolHashTips = swarm.children.map((c) => c.toolHashTip).filter(Boolean);
  return swarm;
}

export function swarmReceiptSummary(swarm) {
  if (!swarm) return { ok: false, reason: "missing" };
  return {
    ok: true,
    parentId: swarm.parentId,
    childCount: (swarm.children || []).length,
    totalUsd: swarm.totalUsd || 0,
    hardBlocks: swarm.hardBlocks || 0,
    anyCircuit: (swarm.children || []).some((c) => c.quotaHardCircuit?.tripped),
  };
}

export default { createSwarmReceipt, attachChildReceipt, swarmReceiptSummary };
