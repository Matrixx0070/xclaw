/**
 * Context Sharder — Splits large contexts using tiktoken for accurate token counting
 * Supports: text sharding, file sharding, overlap preservation
 */
import { getConfig } from "./config.mjs";
import { readFileSync } from "fs";

export class ContextSharder {
  constructor() {
    const cfg = getConfig().swarm.contextSharding;
    this.shardSize = cfg.shardSize;
    this.overlap = cfg.overlap;
    this.enabled = cfg.enabled;
    this._encoder = null;
  }

  async _getEncoder() {
    if (!this._encoder) {
      try {
        const { encoding_for_model } = await import("tiktoken");
        this._encoder = encoding_for_model("gpt-4");
      } catch {
        // Fallback to rough estimation
        this._encoder = null;
      }
    }
    return this._encoder;
  }

  countTokens(text) {
    if (!text) return 0;
    if (this._encoder) {
      return this._encoder.encode(text).length;
    }
    // Rough fallback: ~3 chars per token
    return Math.ceil(text.length / 3);
  }

  async shardText(text) {
    if (!this.enabled || !text) {
      return [{ index: 0, total: 1, content: text || "", startOffset: 0, endOffset: text?.length || 0 }];
    }

    await this._getEncoder();
    const tokens = this.countTokens(text);

    if (tokens <= this.shardSize) {
      return [{ index: 0, total: 1, content: text, startOffset: 0, endOffset: text.length }];
    }

    // Calculate shard boundaries
    const shards = [];
    let startOffset = 0;
    let index = 0;

    while (startOffset < text.length) {
      // Find end offset for this shard
      let endOffset = this._findOffsetForTokens(text, startOffset, this.shardSize);

      // Extend to paragraph/code boundary
      endOffset = this._extendToBoundary(text, endOffset);

      shards.push({
        index,
        total: 0, // Will update after
        content: text.slice(startOffset, endOffset),
        startOffset,
        endOffset,
        tokenEstimate: this.countTokens(text.slice(startOffset, endOffset)),
      });

      // Move start with overlap
      const overlapChars = Math.min(this.overlap * 3, Math.floor((endOffset - startOffset) * 0.1));
      startOffset = Math.max(endOffset - overlapChars, startOffset + 1);
      index++;

      // Prevent infinite loop
      if (startOffset >= text.length) break;
    }

    // Update total
    shards.forEach(s => s.total = shards.length);
    return shards;
  }

  _findOffsetForTokens(text, startOffset, targetTokens) {
    let low = startOffset;
    let high = text.length;
    let best = high;

    while (low <= high) {
      const mid = Math.floor((low + high) / 2);
      const tokens = this.countTokens(text.slice(startOffset, mid));

      if (tokens <= targetTokens) {
        best = mid;
        low = mid + 1;
      } else {
        high = mid - 1;
      }
    }

    return best;
  }

  _extendToBoundary(text, offset) {
    // Try to extend to end of paragraph or code block
    const searchWindow = 500;
    const searchStart = Math.min(offset, text.length);
    const searchEnd = Math.min(offset + searchWindow, text.length);
    const window = text.slice(searchStart, searchEnd);

    // Look for paragraph break
    const paraBreak = window.search(/\n\s*\n/);
    if (paraBreak !== -1) {
      return searchStart + paraBreak + 2;
    }

    // Look for sentence end
    const sentenceEnd = window.search(/[.!?]\s+/);
    if (sentenceEnd !== -1 && sentenceEnd < 200) {
      return searchStart + sentenceEnd + 2;
    }

    // Look for line break
    const lineBreak = window.search(/\n/);
    if (lineBreak !== -1 && lineBreak < 100) {
      return searchStart + lineBreak + 1;
    }

    return offset;
  }

  async shardFiles(filePaths) {
    const contents = [];
    for (const path of filePaths) {
      try {
        const content = readFileSync(path, "utf-8");
        contents.push(`=== FILE: ${path} ===
${content}
`);
      } catch (e) {
        console.warn(`[swarm-sharder] Could not read ${path}:`, e.message);
      }
    }
    return await this.shardText(contents.join("\n"));
  }

  async shardWithMetadata(text, metadata = {}) {
    const shards = await this.shardText(text);
    return shards.map(s => ({
      ...s,
      metadata: { ...metadata, shardIndex: s.index, totalShards: s.total },
    }));
  }
}
