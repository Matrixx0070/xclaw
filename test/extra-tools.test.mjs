import { describe, it } from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  createGlobTool,
  createGrepTool,
  createWebFetchTool,
  createWebSearchTool,
  createExtraTools,
} from "../src/tools/extra-tools.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

describe("extra tools", () => {
  it("exports four tools", () => {
    const tools = createExtraTools({ workingDir: root });
    assert.deepEqual(
      tools.map((t) => t.name).sort(),
      ["glob", "grep", "web_fetch", "web_search"]
    );
  });

  it("glob finds mjs under src", async () => {
    const tool = createGlobTool({ workingDir: root });
    const r = await tool.execute({ pattern: "**/extra-tools.mjs" });
    assert.equal(r.isError, undefined);
    const text = r.content[0].text;
    assert.match(text, /extra-tools\.mjs/);
  });

  it("grep finds createExtraTools", async () => {
    const tool = createGrepTool({ workingDir: root });
    const r = await tool.execute({
      pattern: "createExtraTools",
      path: "src/tools",
      max_matches: 10,
    });
    assert.equal(r.isError, undefined);
    assert.match(r.content[0].text, /createExtraTools/);
  });

  it("web_fetch gets example.com", async () => {
    const tool = createWebFetchTool();
    const r = await tool.execute({ url: "https://example.com", max_chars: 2000 });
    if (r.isError) {
      // network may be restricted in some envs
      assert.ok(r.content[0].text);
      return;
    }
    assert.match(r.content[0].text, /Example Domain/i);
  });

  it("web_search returns structured text", async () => {
    const tool = createWebSearchTool();
    const r = await tool.execute({ query: "OpenAI API", num_results: 5 });
    assert.equal(r.isError, undefined);
    assert.ok(r.content[0].text.length > 0);
  });
});
