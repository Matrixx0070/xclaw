/**
 * Vote Merge — Majority voting for conflicting claims
 * Good for factual queries with multiple agents
 */
export class VoteMerge {
  async merge(results, originalQuery, outputFormat) {
    // Extract claims from each result
    const claims = new Map(); // claim text -> { agents: [], count: 0 }

    for (const result of results) {
      const content = result.content || "";
      // Simple sentence splitting for claim extraction
      const sentences = content.split(/(?<=[.!?])\s+/).filter(s => s.trim().length > 20);

      for (const sentence of sentences) {
        const normalized = sentence.trim().toLowerCase();
        if (!claims.has(normalized)) {
          claims.set(normalized, { text: sentence.trim(), agents: [], count: 0 });
        }
        claims.get(normalized).agents.push(result.agentId || "unknown");
        claims.get(normalized).count++;
      }
    }

    // Sort by vote count
    const sortedClaims = Array.from(claims.values())
      .sort((a, b) => b.count - a.count);

    const totalAgents = results.length;
    const consensus = sortedClaims.filter(c => c.count > totalAgents / 2);
    const disputed = sortedClaims.filter(c => c.count <= totalAgents / 2 && c.count > 1);
    const minority = sortedClaims.filter(c => c.count === 1);

    const sections = [
      "## Consensus (Majority Agreement)",
      consensus.map(c => `- ${c.text} (${c.count}/${totalAgents} agents)`).join("\n"),
      "",
      "## Disputed Claims",
      disputed.map(c => `- ${c.text} (${c.count}/${totalAgents} agents: ${c.agents.join(", ")})`).join("\n"),
      "",
      "## Minority Views",
      minority.map(c => `- ${c.text} (${c.agents[0]})`).join("\n"),
    ];

    const confidence = consensus.length / (consensus.length + disputed.length + 0.001);

    return {
      summary: `Vote-based aggregation: ${consensus.length} consensus, ${disputed.length} disputed`,
      detailedResult: sections.join("\n"),
      artifacts: [],
      confidenceScore: Math.min(confidence, 0.95),
      conflicts: disputed.map(c => ({
        point: c.text,
        agents: c.agents,
        issue: "No majority agreement",
        resolution: "Listed as disputed",
      })),
      sources: [],
    };
  }
}
