/**
 * Quorum Merge — Quorum-based consensus with LLM arbitration
 * Best for critical decisions requiring high confidence
 */
import { formatQuorumMergePrompt } from "../prompts.mjs";

export class QuorumMerge {
  constructor(llmClient) {
    this.llm = llmClient;
  }

  async merge(results, originalQuery, outputFormat) {
    // First pass: extract structured answers from each agent
    const agentOutputs = results.map((r, i) => ({
      agentId: r.agentId || `agent_${i}`,
      role: r.role || r.agentRole || "unknown",
      content: r.content || JSON.stringify(r),
      confidence: r.confidence || 0.5,
    }));

    // Weight by role (fact_checkers get higher weight for factual claims)
    const roleWeights = {
      fact_checker: 2.0,
      analyst: 1.5,
      researcher: 1.0,
      coder: 1.0,
      writer: 0.8,
      browser: 1.0,
      custom: 1.0,
    };

    for (const output of agentOutputs) {
      output.weight = roleWeights[output.role] || 1.0;
    }

    // Use LLM for final arbitration
    if (this.llm) {
      try {
        const messages = formatQuorumMergePrompt(agentOutputs);
        const schema = {
          type: "object",
          properties: {
            consensus: {
              type: "object",
              properties: {
                point: { type: "string" },
                supportingAgents: { type: "array", items: { type: "string" } },
                confidence: { type: "number" },
              },
            },
            disagreements: {
              type: "array",
              items: {
                type: "object",
                properties: {
                  point: { type: "string" },
                  votes: { type: "object" },
                  majority: { type: "string" },
                  confidence: { type: "number" },
                },
              },
            },
            unresolved: { type: "array", items: { type: "string" } },
            finalAnswer: { type: "string" },
          },
        };

        const response = await this.llm.structuredOutput(messages, schema, 0.1);

        return {
          summary: response.consensus?.point || "Quorum merge completed",
          detailedResult: response.finalAnswer || "",
          artifacts: [],
          confidenceScore: response.consensus?.confidence || 0.7,
          conflicts: (response.disagreements || []).map(d => ({
            point: d.point,
            agents: Object.keys(d.votes || {}),
            issue: "Quorum split",
            resolution: d.majority ? `Majority: ${d.majority}` : "Unresolved",
          })),
          sources: [],
          quorumData: response,
        };
      } catch (e) {
        console.warn("[swarm-merge] Quorum LLM merge failed, using weighted vote:", e.message);
      }
    }

    // Fallback: weighted vote
    return this._weightedVote(agentOutputs, originalQuery);
  }

  _weightedVote(agentOutputs, originalQuery) {
    // Group by content similarity (simplified)
    const groups = new Map();
    for (const output of agentOutputs) {
      const key = output.content.slice(0, 100).toLowerCase();
      if (!groups.has(key)) {
        groups.set(key, { outputs: [], totalWeight: 0 });
      }
      groups.get(key).outputs.push(output);
      groups.get(key).totalWeight += output.weight;
    }

    const sorted = Array.from(groups.values()).sort((a, b) => b.totalWeight - a.totalWeight);
    const winner = sorted[0];

    return {
      summary: `Weighted quorum: ${winner.outputs.length} agents, weight ${winner.totalWeight.toFixed(1)}`,
      detailedResult: winner.outputs.map(o => `## ${o.role} (${o.agentId})
${o.content}`).join("\n\n"),
      artifacts: [],
      confidenceScore: Math.min(winner.totalWeight / agentOutputs.reduce((s, o) => s + o.weight, 0), 0.95),
      conflicts: sorted.slice(1).map(g => ({
        point: g.outputs[0].content.slice(0, 100),
        agents: g.outputs.map(o => o.agentId),
        issue: "Lower weighted vote",
        resolution: "Included as alternative view",
      })),
      sources: [],
    };
  }
}
