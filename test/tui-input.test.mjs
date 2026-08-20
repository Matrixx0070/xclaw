import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  chunkCells,
  indexAtCell,
  prevCharIndex,
  nextCharIndex,
  layoutInput,
  moveCaretByRow,
  trimLines,
  renderApprovalPrompt,
  renderChatScreen,
  decodeKeys,
  visibleWidth,
} from "../src/cli/tui.mjs";

const ESC = "\u001b";
const CJK = "語"; // 語 — two cells wide
const EMOJI = "😀"; // 😀 — surrogate pair

describe("chunkCells", () => {
  it("never exceeds the cell budget", () => {
    for (const chunk of chunkCells(CJK.repeat(40), 20)) {
      assert.ok(visibleWidth(chunk.text) <= 20, `chunk was ${visibleWidth(chunk.text)} cells`);
    }
  });

  it("never splits a wide character across chunks", () => {
    // an odd width must round down, not straddle the cell pair
    for (const chunk of chunkCells(CJK.repeat(10), 5)) {
      assert.equal(visibleWidth(chunk.text) % 2, 0);
    }
  });

  it("round-trips the original text", () => {
    const text = `ab${CJK}cd${EMOJI}ef`;
    assert.equal(chunkCells(text, 3).map((c) => c.text).join(""), text);
  });

  it("reports offsets into the source string", () => {
    const chunks = chunkCells("abcdef", 2);
    assert.deepEqual(chunks.map((c) => [c.from, c.to]), [[0, 2], [2, 4], [4, 6]]);
  });

  it("returns one empty chunk for empty input", () => {
    assert.deepEqual(chunkCells("", 10), [{ text: "", from: 0, to: 0 }]);
  });
});

describe("indexAtCell", () => {
  it("maps a cell column back to a string index", () => {
    assert.equal(indexAtCell("abc", 2), 2);
    assert.equal(indexAtCell(CJK.repeat(3), 4), 2); // two wide chars = 4 cells
  });

  it("clamps past the end", () => {
    assert.equal(indexAtCell("ab", 99), 2);
  });
});

describe("prevCharIndex / nextCharIndex", () => {
  it("steps over surrogate pairs", () => {
    assert.equal(nextCharIndex(`a${EMOJI}`, 1), 3);
    assert.equal(prevCharIndex(`a${EMOJI}`, 3), 1);
  });

  it("clamps at both ends", () => {
    assert.equal(prevCharIndex("abc", 0), 0);
    assert.equal(nextCharIndex("abc", 3), 3);
  });
});

describe("layoutInput", () => {
  it("turns newlines into separate rows instead of raw control chars", () => {
    const l = layoutInput("alpha\nbravo\ncharlie", 5, 20, 6);
    assert.deepEqual(l.rows, ["alpha", "bravo", "charlie"]);
    for (const row of l.rows) assert.ok(!row.includes("\n"));
  });

  it("places the caret on the right row and column across a newline", () => {
    const l = layoutInput("alpha\nbravo", 8, 20, 6);
    assert.equal(l.cursorRowAbs, 1);
    assert.equal(l.cursorCol, 2);
  });

  it("wraps wide characters within the cell budget", () => {
    const l = layoutInput(CJK.repeat(40), 40, 20, 6);
    for (const row of l.rows) assert.ok(visibleWidth(row) <= 20);
  });

  it("windows around the caret and reports what is hidden", () => {
    const text = Array.from({ length: 12 }, (_, i) => `line${i}`).join("\n");
    const l = layoutInput(text, text.length, 20, 4);
    assert.equal(l.total, 12);
    assert.equal(l.rows.length, 4);
    assert.equal(l.hidden, 8);
    assert.equal(l.rows.at(-1), "line11");
    assert.ok(l.cursorRow >= 0 && l.cursorRow < 4);
  });

  it("keeps the caret visible when it is at the top of a long input", () => {
    const text = Array.from({ length: 12 }, (_, i) => `line${i}`).join("\n");
    const l = layoutInput(text, 0, 20, 4);
    assert.equal(l.first, 0);
    assert.equal(l.cursorRow, 0);
  });
});

describe("moveCaretByRow", () => {
  it("moves down and up between wrapped rows", () => {
    assert.equal(moveCaretByRow("alpha\nbravo", 2, 20, 1), 8);
    assert.equal(moveCaretByRow("alpha\nbravo", 8, 20, -1), 2);
  });

  it("returns null at the edges so history can take over", () => {
    assert.equal(moveCaretByRow("alpha", 2, 20, -1), null);
    assert.equal(moveCaretByRow("alpha", 2, 20, 1), null);
  });
});

describe("trimLines", () => {
  it("caps in place and keeps the newest lines", () => {
    const lines = Array.from({ length: 10 }, (_, i) => i);
    trimLines(lines, 4);
    assert.deepEqual(lines, [6, 7, 8, 9]);
  });

  it("leaves short arrays alone", () => {
    const lines = [1, 2];
    trimLines(lines, 4);
    assert.deepEqual(lines, [1, 2]);
  });
});

describe("renderApprovalPrompt", () => {
  it("offers always-allow below the critical tier", () => {
    const out = renderApprovalPrompt(
      { name: "exec", args: { command: "ls" }, riskTier: "risky" },
      { colour: false, columns: 80 },
    ).join(" ");
    assert.match(out, /approve/);
    assert.match(out, /deny/);
    assert.match(out, /always allow this tool/);
  });

  it("never offers always-allow for critical calls", () => {
    // mirrors /trust: a blanket grant tops out at risky, critical always pends
    const out = renderApprovalPrompt(
      { name: "exec", args: { command: "rm -rf /" }, riskTier: "critical" },
      { colour: false, columns: 80 },
    ).join(" ");
    assert.match(out, /approve/);
    assert.doesNotMatch(out, /always allow/);
  });

  it("shows the tool call and the risk tier", () => {
    const out = renderApprovalPrompt(
      { name: "file_write", args: { file_path: "/etc/hosts" }, riskTier: "critical" },
      { colour: false, columns: 80 },
    ).join(" ");
    assert.match(out, /critical/);
    assert.match(out, /file_write/);
  });
});

describe("decodeKeys — new bindings", () => {
  it("decodes Alt+Enter as a newline key, not a submit", () => {
    const keys = decodeKeys(`${ESC}\r`);
    assert.ok(keys.some((k) => k.name === "altenter"));
    assert.ok(!keys.some((k) => k.name === "enter"));
  });

  it("still decodes a bare Enter as a submit character", () => {
    assert.deepEqual(decodeKeys("\r"), [{ ch: "\r" }]);
  });

  it("keeps multi-line paste payloads intact", () => {
    const keys = decodeKeys(`${ESC}[200~alpha\nbravo${ESC}[201~`);
    assert.deepEqual(keys, [{ paste: "alpha\nbravo" }]);
  });
});

describe("renderChatScreen — width safety", () => {
  const state = {
    transcript: ["x".repeat(200), CJK.repeat(60)],
    input: CJK.repeat(40),
    cursor: 40,
    footer: "footer",
    scroll: 0,
  };

  for (const columns of [24, 32, 40, 60, 80, 120]) {
    it(`emits no row wider than ${columns} columns`, () => {
      const frame = renderChatScreen(state, { colour: false, columns, rows: 24 });
      for (const line of frame) {
        assert.ok(visibleWidth(line) <= columns, `row was ${visibleWidth(line)} cells: ${line}`);
      }
    });
  }

  it("never emits a raw newline inside a frame row", () => {
    const frame = renderChatScreen(
      { ...state, input: "alpha\nbravo\ncharlie", cursor: 5 },
      { colour: false, columns: 100, rows: 30 },
    );
    for (const line of frame) assert.ok(!line.includes("\n"));
    assert.ok(frame.some((l) => l.includes("bravo")));
  });

  it("reports the body budget so the caller pages in step with the frame", () => {
    let layout = null;
    renderChatScreen(
      { ...state, transcript: Array.from({ length: 200 }, (_, i) => `line ${i}`) },
      { colour: false, columns: 80, rows: 24, onLayout: (l) => { layout = l; } },
    );
    assert.ok(layout, "onLayout was not called");
    assert.ok(layout.budget > 0);
    assert.equal(layout.bodyLength, 200);
    assert.equal(layout.maxScroll, 200 - layout.budget);
  });

  it("shows both scroll directions once scrolled up", () => {
    const frame = renderChatScreen(
      { ...state, transcript: Array.from({ length: 200 }, (_, i) => `line ${i}`), scroll: 20 },
      { colour: false, columns: 80, rows: 24 },
    ).join("\n");
    assert.match(frame, /more line\(s\) above/);
    assert.match(frame, /more line\(s\) below/);
  });

  it("renders the approval prompt in place of the input line", () => {
    const frame = renderChatScreen(
      { ...state, approval: { name: "exec", args: { command: "ls" }, riskTier: "risky" } },
      { colour: false, columns: 80, rows: 24 },
    ).join("\n");
    assert.match(frame, /approval required/);
    assert.match(frame, /always allow this tool/);
  });
});
