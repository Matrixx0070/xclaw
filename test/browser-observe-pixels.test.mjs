import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { createBrowserObserveTool } from "../src/tools/browser-tools.mjs";

describe("browser_observe include_pixels", () => {
  it("screenshot isError makes observe isError", async () => {
    const ctx = {
      computer: {
        async callTool(name, args) {
          if (args?.screenshot) {
            return { isError: true, content: [{ type: "text", text: "no png" }] };
          }
          return {
            content: [{ type: "text", text: JSON.stringify({ title: "t", nodes: [] }) }],
          };
        },
        async createSession() {
          return "s";
        },
      },
      sessionId: "s",
      workingDir: "/tmp",
    };
    const tool = createBrowserObserveTool(ctx);
    const out = await tool.execute({ include_pixels: true });
    assert.equal(out.isError, true);
  });
});
