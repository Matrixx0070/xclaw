import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { normalizeAssistantContent } from "../src/agent/loop.mjs";

describe("normalizeAssistantContent", () => {
  it("string", () => {
    assert.equal(normalizeAssistantContent("hi"), "hi");
  });
  it("parts array", () => {
    assert.equal(
      normalizeAssistantContent([{ type: "text", text: "a" }, { text: "b" }]),
      "a\nb"
    );
  });
  it("empty", () => {
    assert.equal(normalizeAssistantContent(null), "");
    assert.equal(normalizeAssistantContent([]), "");
  });
});
