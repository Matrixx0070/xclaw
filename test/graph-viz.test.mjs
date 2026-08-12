import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  topologicalWaves,
  toAsciiWaves,
  toMermaid,
  toDot,
  escapeDotId,
  escapeDotLabel,
  examplePipelineGraph,
} from "../src/agents/graph-viz.mjs";

describe("graph-viz ASCII waves", () => {
  it("example pipeline has 4 waves", () => {
    const waves = topologicalWaves(examplePipelineGraph());
    assert.equal(waves.length, 4);
    assert.equal(waves[0].length, 2);
    assert.equal(waves[1][0].id, "impl");
  });

  it("toAsciiWaves includes legend and status glyphs", () => {
    const text = toAsciiWaves(examplePipelineGraph());
    assert.match(text, /wave 0/);
    assert.match(text, /✓/);
    assert.match(text, /…/);
    assert.match(text, /legend:/);
  });

  it("rejects cycles", () => {
    assert.throws(() =>
      topologicalWaves([
        { id: "a", dependsOn: ["b"] },
        { id: "b", dependsOn: ["a"] },
      ])
    );
  });

  it("toMermaid emits edges", () => {
    const m = toMermaid(examplePipelineGraph());
    assert.match(m, /flowchart/);
    assert.match(m, /r1 --> impl/);
    assert.match(m, /impl --> verify/);
  });

  it("escapeDotId quotes unsafe ids", () => {
    assert.equal(escapeDotId("impl"), "impl");
    assert.equal(escapeDotId("a-b"), '"a-b"');
    assert.equal(escapeDotId('x"y'), '"x\\"y"');
  });

  it("escapeDotLabel escapes quotes and newlines", () => {
    assert.equal(escapeDotLabel('say "hi"'), '"say \\"hi\\""');
    assert.match(escapeDotLabel("a\nb"), /\\n/);
  });

  it("toDot escapes edge endpoints and labels", () => {
    const dot = toDot([
      {
        id: "weird-id",
        role: "research",
        task: 'note with "quotes"',
        status: "done",
        dependsOn: [],
      },
      {
        id: "impl",
        role: "implement",
        task: "wire",
        status: "running",
        dependsOn: ["weird-id"],
      },
    ]);
    assert.match(dot, /digraph Swarm/);
    assert.match(dot, /"weird-id"/);
    assert.match(dot, /"weird-id" -> impl/);
    assert.match(dot, /\\"/); // escaped quote in node label
  });

  it("toDot escapes edge labels (quotes, newlines, backslashes)", () => {
    const dot = toDot([
      {
        id: "a",
        role: "research",
        task: "upstream",
        status: "done",
        dependsOn: [],
      },
      {
        id: "b",
        role: "implement",
        task: "downstream",
        status: "pending",
        dependsOn: ["a"],
        edgeLabel: 'after "A"\nnext\\step',
      },
    ]);
    assert.match(
      dot,
      /a -> b \[label="after \\"A\\"\\nnext\\\\step"\];/
    );
  });

  it("toDot edgeLabels map escapes per-dependency labels", () => {
    const dot = toDot([
      { id: "r1", task: "one", dependsOn: [] },
      { id: "r2", task: "two", dependsOn: [] },
      {
        id: "join",
        task: "merge",
        dependsOn: ["r1", "r2"],
        edgeLabels: {
          r1: 'from "r1"',
          r2: "from r2",
        },
      },
    ]);
    assert.match(dot, /r1 -> join \[label="from \\"r1\\""\];/);
    assert.match(dot, /r2 -> join \[label="from r2"\];/);
  });
});
