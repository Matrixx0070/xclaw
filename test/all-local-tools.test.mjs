import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { createAllLocalTools, localToolNames } from "../src/tools/registry.mjs";

describe("all local tools", () => {
  it("registers expected names", () => {
    const tools = createAllLocalTools({ workingDir: process.cwd() });
    const names = localToolNames(tools);
    for (const n of [
      "glob",
      "grep",
      "web_fetch",
      "web_search",
      "file_type",
      "markitdown",
      "host_capabilities",
      "ocr",
      "office_convert",
      "view_image",
      "finance_quote",
      "search_images",
      "generate_image",
      "edit_image",
      "x_keyword_search",
      "x_user_search",
      "x_thread_fetch",
      "search_connected_tools",
      "call_connected_tool",
    ]) {
      assert.ok(names.includes(n), `missing ${n}`);
    }
    assert.ok(names.length >= 19);
  });

  it("host_capabilities works", async () => {
    const tools = createAllLocalTools({ workingDir: process.cwd() });
    const r = await tools.find((t) => t.name === "host_capabilities").execute({});
    assert.ok(r.content[0].text.includes("ffmpeg") || r.content[0].text.includes("python"));
  });

  it("search_connected_tools finds voice", async () => {
    const tools = createAllLocalTools({ workingDir: process.cwd() });
    const r = await tools.find((t) => t.name === "search_connected_tools").execute({ query: "voice speak" });
    assert.match(r.content[0].text, /voice_speak/);
  });
});
