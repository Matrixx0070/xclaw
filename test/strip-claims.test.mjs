import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { stripClaimsBlock } from "../src/agent/loop.mjs";
import { stripLiveScaffold } from "../src/agent/claims-scaffold.mjs";

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

describe("stripLiveScaffold (hide the scaffold mid-stream, not just when finished)", () => {
  // the exact buffer the live gateway streamed on 2026-08-20
  const answer = "17 × 23 is **391**.";
  const full = `${answer}\n\n\`\`\`json\n{"claims":["17*23 equals 391"],"evidence_ids":["xclaw_bash"]}\n\`\`\``;

  it("removes the completed block", () => {
    assert.equal(stripLiveScaffold(full), answer);
  });

  it("hides the block while it is still arriving", () => {
    // every prefix from the opening brace on must already be hidden
    const openAt = full.indexOf('{"');
    for (let i = openAt + 1; i <= full.length; i += 1) {
      assert.equal(stripLiveScaffold(full.slice(0, i)), answer, `leaked at prefix ${i}`);
    }
  });

  it("keeps a real code block the user asked for", () => {
    const code = 'Here:\n\n```json\n{"port":8080}\n```';
    assert.equal(stripLiveScaffold(code), code);
    const open = 'Here:\n\n```json\n{"port":';
    assert.equal(stripLiveScaffold(open), open);
  });

  it("leaves prose and a bare unopened fence alone", () => {
    assert.equal(stripLiveScaffold("Here is your answer."), "Here is your answer.");
    const bare = "Done.\n\n```json\n";
    assert.equal(stripLiveScaffold(bare), bare.trimEnd());
  });
});
