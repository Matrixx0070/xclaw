/**
 * LLM Merge — Intelligent merging using LLM to resolve conflicts
 * Best quality, highest cost
 */
import { formatAggregatorPrompt } from "../prompts.mjs";

export class LLMMerge {
  constructor(llmClient) {
    this.llm = llmClient;
  }

  async merge(results, originalQuery, outputFormat) {
    const messages = formatAggregatorPrompt(results, outputFormat);

    const schema = {
      type: "object",
      properties: {
        summary: { type: "string" },
        detailedResult: { type: "string" },
        artifacts: {
          type: "array",
          items: {
            type: "object",
            properties: {
              type: { type: "string" },
              content: { type: "string" },
              metadata: { type: "object" },
            },
          },
        },
        confidenceScore: { type: "number" },
        conflicts: {
          type: "array",
          items: {
            type: "object",
            properties: {
              point: { type: "string" },
              agents: { type: "array", items: { type: "string" } },
              issue: { type: "string" },
              resolution: { type: "string" },
            },
          },
        },
        sources: {
          type: "array",
          items: {
            type: "object",
            properties: {
              agentId: { type: "string" },
              tool: { type: "string" },
              url: { type: "string" },
            },
          },
        },
      },
      required: ["summary", "detailedResult", "confidenceScore"],
    };

    const response = await this.llm.structuredOutput(messages, schema, 0.1);

    return {
      summary: response.summary || "",
      detailedResult: response.detailedResult || "",
      artifacts: response.artifacts || [],
      confidenceScore: response.confidenceScore || 0.7,
      conflicts: response.conflicts || [],
      sources: response.sources || [],
    };
  }
}
