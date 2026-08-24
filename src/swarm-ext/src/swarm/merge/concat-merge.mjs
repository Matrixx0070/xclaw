/**
 * Concat Merge — Simple concatenation with headers
 * Fastest, lowest cost, no conflict resolution
 */
export class ConcatMerge {
  async merge(results, originalQuery, outputFormat) {
    const sections = results
      .filter(r => r.content)
      .map((r, i) => {
        const role = (r.role || r.agentRole || "agent").toUpperCase();
        const id = r.agentId || `agent_${i}`;
        return `## [${role}] ${id}

${r.content}`;
      });

    return {
      summary: `Aggregated results for: ${originalQuery}`,
      detailedResult: sections.join("\n\n---\n\n"),
      artifacts: [],
      confidenceScore: 0.6,
      conflicts: [],
      sources: [],
    };
  }
}
