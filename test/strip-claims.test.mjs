import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { stripClaimsBlock } from "../src/agent/loop.mjs";

describe("stripClaimsBlock (hide grounding scaffold from channel replies)", () => {
  it("removes a fenced json claims block at the end", () => {
    const t = 'Generated a logo.\n\nSaved at: /x.png\n\n```json\n{"claims":["Generated a logo"],"evidence_ids":["generate_image"]}\n```';
    const out = stripClaimsBlock(t);
    assert.doesNotMatch(out, /claims|evidence_ids|```/);
    assert.match(out, /Saved at: \/x\.png$/);
  });
  it("removes a bare trailing claims object", () => {
    assert.equal(stripClaimsBlock('Done.\n{"claims":["x"],"evidence_ids":["t"]}'), "Done.");
  });
  it("leaves normal text (and unrelated json) untouched", () => {
    assert.equal(stripClaimsBlock("Here is your answer."), "Here is your answer.");
    const keep = 'Config: ```json\n{"port":8080}\n```';
    assert.equal(stripClaimsBlock(keep), keep);
  });
});
