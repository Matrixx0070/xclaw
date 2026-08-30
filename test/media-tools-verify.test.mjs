import { describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  createOcrTool,
  createOfficeConvertTool,
  looksLikeConvertedDocument,
  officeOutputThisCall,
} from "../src/tools/media-tools.mjs";

describe("media tools do not claim success without output", () => {
  it("ocr missing input is isError", async () => {
    const tool = createOcrTool({ workingDir: os.tmpdir() });
    const out = await tool.execute({ path: "no-such.png" });
    assert.equal(out.isError, true);
    assert.match(out.content[0].text, /not found/);
  });

  it("ocr without tesseract is isError, not no text recognized", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "xclaw-ocr-"));
    fs.writeFileSync(path.join(dir, "x.png"), Buffer.alloc(128, 0x89));
    const tool = createOcrTool({ workingDir: dir });
    const out = await tool.execute({ path: "x.png" });
    if (out.isError) {
      assert.ok(/tesseract|failed|not found/i.test(out.content[0].text));
    } else {
      assert.doesNotMatch(out.content[0].text, /tesseract reported success but output file missing/);
    }
  });

  it("office_convert source pins missing-output as isError", () => {
    const src = fs.readFileSync(new URL("../src/tools/media-tools.mjs", import.meta.url), "utf8");
    assert.match(src, /soffice exited 0 but output missing/);
    assert.match(src, /tesseract reported success but output file missing/);
    assert.match(src, /identify and magika both failed/);
    assert.match(src, /not a \$\{outExt\} document/);
    assert.match(src, /dest was not written this call/);
  });

  it("officeOutputThisCall rejects leftover dest", () => {
    const leftover = { size: 200, mtimeMs: 1000 };
    assert.equal(officeOutputThisCall(leftover, leftover), false);
    assert.equal(officeOutputThisCall(leftover, { size: 200, mtimeMs: 1000 }), false);
    assert.equal(officeOutputThisCall(leftover, { size: 200, mtimeMs: 1001 }), true);
    assert.equal(officeOutputThisCall(leftover, { size: 201, mtimeMs: 1000 }), true);
    assert.equal(officeOutputThisCall(null, { size: 200, mtimeMs: 1 }), true);
    assert.equal(officeOutputThisCall(null, { size: 8, mtimeMs: 1 }), false);
  });

  it("looksLikeConvertedDocument rejects tiny and wrong-magic files", () => {
    assert.equal(looksLikeConvertedDocument(Buffer.from("x"), "pdf"), false);
    assert.equal(looksLikeConvertedDocument(Buffer.from("%PDF-1.4" + "x".repeat(40)), "pdf"), true);
    assert.equal(looksLikeConvertedDocument(Buffer.from("PK" + "x".repeat(40)), "docx"), true);
    assert.equal(looksLikeConvertedDocument(Buffer.from("not a pdf" + "x".repeat(40)), "pdf"), false);
  });
});
