import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  optimizePrefix,
  ensurePrefixStable,
  assertPrefixStable,
  normalizePrefixText,
  defaultCacheOptimizePolicy,
} from "../src/tokens/prefix-optimize.mjs";

describe("prefix cache optimize", () => {
  it("normalizePrefixText collapses blank lines", () => {
    assert.equal(normalizePrefixText("a\n\n\n\nb"), "a\n\nb");
  });

  it("optimizePrefix sorts tools and fingerprints", () => {
    const { systemMessage, tools, fingerprint } = optimizePrefix({
      systemMessage: { role: "system", content: "  hello\r\n\r\n\r\nworld  " },
      tools: [
        { type: "function", function: { name: "z_tool", parameters: {} } },
        { type: "function", function: { name: "a_tool", parameters: {} } },
      ],
    });
    assert.equal(systemMessage.content, "hello\n\nworld");
    assert.equal(tools[0].function.name, "a_tool");
    assert.ok(fingerprint.hash.length === 16);
  });

  it("ensurePrefixStable restores mutated system and strips extra system msgs", () => {
    const { systemMessage, tools, fingerprint } = optimizePrefix({
      systemMessage: { role: "system", content: "STABLE PREFIX" },
      tools: [{ type: "function", function: { name: "bash", parameters: {} } }],
    });
    const messages = [
      { role: "system", content: "CORRUPTED" },
      { role: "user", content: "hi" },
      { role: "system", content: "should strip" },
      { role: "assistant", content: "yo" },
    ];
    const out = ensurePrefixStable(messages, systemMessage, fingerprint.hash, tools);
    assert.equal(out.messages[0].content, "STABLE PREFIX");
    assert.equal(out.strippedSystem, 1);
    assert.ok(out.messages.every((m, i) => i === 0 || m.role !== "system"));
    const stab = assertPrefixStable(out.messages, fingerprint.hash, tools);
    assert.equal(stab.ok, true);
  });

  it("defaultCacheOptimizePolicy restores prefix by default", () => {
    const p = defaultCacheOptimizePolicy({});
    assert.equal(p.restorePrefixEachTurn, true);
    assert.equal(p.cacheBreakpoints.enabled, true);
  });
});
