/**
 * Result Aggregator — Merges parallel sub-agent outputs
 * Supports: LLM merge, concatenation, voting, quorum
 */
import { getConfig } from "./config.mjs";
import { formatAggregatorPrompt, formatQuorumMergePrompt } from "./prompts.mjs";
import { LLMMerge } from "./merge/llm-merge.mjs";
import { ConcatMerge } from "./merge/concat-merge.mjs";
import { VoteMerge } from "./merge/vote-merge.mjs";
import { QuorumMerge } from "./merge/quorum-merge.mjs";

export class ResultAggregator {
  constructor(llmClient) {
    this.llm = llmClient;
    this.mergers = {
      llm: new LLMMerge(llmClient),
      concat: new ConcatMerge(),
      vote: new VoteMerge(),
      quorum: new QuorumMerge(llmClient),
    };
  }

  async aggregate(subtaskResults, originalQuery, outputFormat = "markdown", mergePolicy = null) {
    const policy = mergePolicy || getConfig().swarm.mergePolicy;
    const mode = policy.mode || "llm";

    console.log(`[swarm-aggregator] Aggregating ${subtaskResults.length} results using ${mode} mode`);

    // Filter out failed results
    const successful = subtaskResults.filter(r => !r.error);
    const failed = subtaskResults.filter(r => r.error);

    if (!successful.length) {
      return {
        summary: "All subtasks failed",
        detailedResult: "",
        artifacts: [],
        confidenceScore: 0,
        errors: failed.map(r => r.error),
        subtaskCount: subtaskResults.length,
        successfulCount: 0,
        failedCount: failed.length,
      };
    }

    // Use selected merge strategy
    const merger = this.mergers[mode] || this.mergers.llm;
    let result;

    try {
      result = await merger.merge(successful, originalQuery, outputFormat);
    } catch (e) {
      console.warn(`[swarm-aggregator] ${mode} merge failed, using fallback:`, e.message);
      // Fallback to concat
      result = await this.mergers.concat.merge(successful, originalQuery, outputFormat);
      result._fallback = true;
      result._fallbackReason = e.message;
    }

    // Add metadata
    return {
      ...result,
      originalQuery,
      subtaskCount: subtaskResults.length,
      successfulCount: successful.length,
      failedCount: failed.length,
      failedTasks: failed.map(r => ({ agentId: r.agentId, error: r.error })),
      mergeMode: mode,
      mergePolicy: policy,
    };
  }
}
