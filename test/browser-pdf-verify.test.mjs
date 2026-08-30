import { describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createBrowserPdfTool } from "../src/tools/browser-tools.mjs";

describe("browser_pdf", () => {
  it("HTML snapshot without a PDF file is isError", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "xclaw-bpdf-"));
    const tool = createBrowserPdfTool({
      workingDir: dir,
      computer: {
        async callTool() {
          return {
            content: [{ type: "text", text: "<html><body>hi</body></html>" }],
          };
        },
        async createSession() {
          return "s";
        },
      },
      sessionId: "s",
    });
    const dest = path.join(dir, "out.pdf");
    const out = await tool.execute({ out: dest });
    assert.equal(out.isError, true);
    assert.match(out.content[0].text, /PDF not produced/);
    assert.equal(fs.existsSync(dest), false);
  });

  it("source does not claim Saved HTML snapshot as success", () => {
    const src = fs.readFileSync(new URL("../src/tools/browser-tools.mjs", import.meta.url), "utf8");
    assert.match(src, /PDF not produced/);
    assert.doesNotMatch(src, /Saved HTML snapshot:/);
  });
});
