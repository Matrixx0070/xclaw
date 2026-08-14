
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  buildCacheBlocks,
  blocksToAnthropicContent,
  buildSystemMessageWithBreakpoints,
  shouldUseAnthropicCacheControl,
} from "../src/tokens/cache-breakpoints.mjs";
import {
  capCacheBreakpoints,
  applyToolCacheBreakpoints,
  countCacheBreakpoints,
} from "../src/providers/anthropic-messages.mjs";

describe("Anthropic cache breakpoints", () => {
  it("marks base/memory/skills with cache_control", () => {
    const blocks = buildCacheBlocks({
      basePrompt: "You are XClaw.",
      contextSections: "## Project memory\nBe careful.\n\n## Available skills\n- bash",
    });
    const parts = blocksToAnthropicContent(blocks);
    assert.ok(parts.length >= 2);
    assert.ok(parts.every((p) => p.cache_control?.type === "ephemeral" || !p.cache_control));
    assert.ok(parts.filter((p) => p.cache_control).length >= 2);
  });

  it("buildSystemMessage uses anthropic mode for claude", () => {
    const { message, meta } = buildSystemMessageWithBreakpoints({
      basePrompt: "Identity",
      contextSections: "## Project memory\nX",
      cfg: { agent: { provider: "anthropic" }, tokens: { cacheBreakpoints: { enabled: true } } },
      provider: "anthropic",
      model: "claude-sonnet-5",
    });
    assert.equal(meta.mode, "anthropic_cache_control");
    assert.ok(Array.isArray(message.content));
    assert.ok(message.content.some((c) => c.cache_control));
  });

  it("capCacheBreakpoints keeps last 4", () => {
    const blocks = Array.from({ length: 6 }, (_, i) => ({
      type: "text",
      text: `b${i}`,
      cache_control: { type: "ephemeral" },
    }));
    const capped = capCacheBreakpoints(blocks, 4);
    assert.equal(capped.filter((b) => b.cache_control).length, 4);
  });

  it("applyToolCacheBreakpoints marks last tool when budget remains", () => {
    const tools = [
      { name: "a", description: "", input_schema: { type: "object" } },
      { name: "b", description: "", input_schema: { type: "object" } },
    ];
    const marked = applyToolCacheBreakpoints(tools, { systemBreakpointCount: 3, maxBreakpoints: 4 });
    assert.equal(marked[0].cache_control, undefined);
    assert.deepEqual(marked[1].cache_control, { type: "ephemeral" });
  });

  it("skips tool mark when system already used 4 breakpoints", () => {
    const tools = [{ name: "a", description: "", input_schema: { type: "object" } }];
    const marked = applyToolCacheBreakpoints(tools, { systemBreakpointCount: 4, maxBreakpoints: 4 });
    assert.equal(marked[0].cache_control, undefined);
  });

  it("shouldUseAnthropicCacheControl auto-detects", () => {
    assert.equal(shouldUseAnthropicCacheControl({ agent: { provider: "anthropic" } }), true);
    assert.equal(shouldUseAnthropicCacheControl({ agent: { provider: "xai" } }), false);
  });
});
