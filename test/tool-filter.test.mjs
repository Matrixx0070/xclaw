import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { compileToolFilter, filterToolDefs } from "../src/agent/tool-filter.mjs";

describe("tool filter", () => {
  it("null when allow absent or empty", () => {
    assert.equal(compileToolFilter(null), null);
    assert.equal(compileToolFilter(undefined), null);
    assert.equal(compileToolFilter([]), null);
  });

  it("exact name match", () => {
    const f = compileToolFilter(["xclaw_bash", "file_read"]);
    assert.equal(f.match("xclaw_bash"), true);
    assert.equal(f.match("file_read"), true);
    assert.equal(f.match("web_search"), false);
  });

  it("prefix glob", () => {
    const f = compileToolFilter(["xclaw_file_*", "mcp__*"]);
    assert.equal(f.match("xclaw_file_read"), true);
    assert.equal(f.match("xclaw_file_write"), true);
    assert.equal(f.match("xclaw_bash"), false);
    assert.equal(f.match("mcp__server__tool"), true);
  });

  it("wildcard * allows all", () => {
    const f = compileToolFilter(["*"]);
    assert.equal(f.match("anything"), true);
  });

  it("allowsPrefix for plane skip", () => {
    const f = compileToolFilter(["mcp__foo", "xclaw_bash"]);
    assert.equal(f.allowsPrefix("mcp__"), true);
    assert.equal(f.allowsPrefix("xclaw_"), true);
    assert.equal(f.allowsPrefix("browser_"), false);
  });

  it("filterToolDefs keeps matching OpenAI-shaped tools", () => {
    const tools = [
      { type: "function", function: { name: "xclaw_bash" } },
      { type: "function", function: { name: "web_search" } },
      { type: "function", function: { name: "file_read" } },
    ];
    const f = compileToolFilter(["xclaw_bash", "file_read"]);
    const out = filterToolDefs(tools, f);
    assert.equal(out.length, 2);
    assert.deepEqual(
      out.map((t) => t.function.name).sort(),
      ["file_read", "xclaw_bash"]
    );
  });

  it("filterToolDefs no-op when filter null", () => {
    const tools = [{ type: "function", function: { name: "a" } }];
    assert.equal(filterToolDefs(tools, null), tools);
  });
});
