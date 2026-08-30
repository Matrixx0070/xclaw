import { describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  looksLikeImageBytes,
  createSearchImagesTool,
} from "../src/tools/image-tools.mjs";

function htmlPage() {
  return Buffer.from(
    "<!DOCTYPE html><html><head><title>not an image</title></head><body>" +
      "error".repeat(40) +
      "</body></html>"
  );
}

describe("search_images does not treat HTML as an image", () => {
  it("looksLikeImageBytes rejects HTML, JSON, and tiny payloads", () => {
    assert.equal(looksLikeImageBytes(htmlPage(), "text/html"), false);
    assert.equal(looksLikeImageBytes(htmlPage(), "image/jpeg"), false);
    assert.equal(looksLikeImageBytes(Buffer.from('{"error":"' + "x".repeat(120) + '"}')), false);
    assert.equal(looksLikeImageBytes(Buffer.alloc(50, 0xff)), false);
    assert.equal(looksLikeImageBytes(Buffer.alloc(128, 0x89)), true);
    assert.equal(looksLikeImageBytes(Buffer.from([0xff, 0xd8, ...Buffer.alloc(120, 0x00)])), true);
  });

  it("HTTP 200 HTML error page is isError, not a saved image", async () => {
    const prevBing = process.env.BING_SEARCH_KEY;
    const prevSerp = process.env.SERPAPI_API_KEY;
    delete process.env.BING_SEARCH_KEY;
    delete process.env.SERPAPI_API_KEY;
    const orig = globalThis.fetch;
    globalThis.fetch = async () => ({
      ok: true,
      status: 200,
      headers: { get: (k) => (String(k).toLowerCase() === "content-type" ? "text/html" : null) },
      async arrayBuffer() {
        return htmlPage();
      },
      async json() {
        return { results: [], images_results: [], value: [] };
      },
    });
    try {
      const dir = fs.mkdtempSync(path.join(os.tmpdir(), "xclaw-simg-"));
      const tool = createSearchImagesTool({ workingDir: dir });
      const out = await tool.execute({ query: "red circle", count: 1 });
      assert.equal(out.isError, true);
      assert.match(out.content[0].text, /No images/i);
      const art = path.join(dir, "artifacts", "images");
      if (fs.existsSync(art)) {
        const files = fs.readdirSync(art);
        assert.equal(files.length, 0, `HTML should not land as an image: ${files.join(",")}`);
      }
    } finally {
      globalThis.fetch = orig;
      if (prevBing === undefined) delete process.env.BING_SEARCH_KEY;
      else process.env.BING_SEARCH_KEY = prevBing;
      if (prevSerp === undefined) delete process.env.SERPAPI_API_KEY;
      else process.env.SERPAPI_API_KEY = prevSerp;
    }
  });

  it("real JPEG bytes are success and the file re-reads", async () => {
    const prevBing = process.env.BING_SEARCH_KEY;
    const prevSerp = process.env.SERPAPI_API_KEY;
    delete process.env.BING_SEARCH_KEY;
    delete process.env.SERPAPI_API_KEY;
    const jpeg = Buffer.from([0xff, 0xd8, 0xff, 0xe0, ...Buffer.alloc(200, 0x11)]);
    const orig = globalThis.fetch;
    let n = 0;
    globalThis.fetch = async (url) => {
      n += 1;
      const u = String(url);
      if (u.includes("openverse")) {
        return {
          ok: true,
          status: 200,
          headers: { get: () => "application/json" },
          async json() {
            return { results: [{ title: "dot", url: "https://example.test/dot.jpg" }] };
          },
          async arrayBuffer() {
            return Buffer.from("{}");
          },
        };
      }
      return {
        ok: true,
        status: 200,
        headers: { get: (k) => (String(k).toLowerCase() === "content-type" ? "image/jpeg" : null) },
        async arrayBuffer() {
          return jpeg;
        },
      };
    };
    try {
      const dir = fs.mkdtempSync(path.join(os.tmpdir(), "xclaw-simg-ok-"));
      const tool = createSearchImagesTool({ workingDir: dir });
      const out = await tool.execute({ query: "dot", count: 1 });
      assert.ok(!out.isError, JSON.stringify(out).slice(0, 300));
      assert.match(out.content[0].text, /path:/);
      const m = out.content[0].text.match(/path:\s+(\S+)/);
      assert.ok(m, "saved path in result");
      assert.ok(fs.existsSync(m[1]));
      assert.equal(fs.readFileSync(m[1]).length, jpeg.length);
      assert.ok(n >= 1);
    } finally {
      globalThis.fetch = orig;
      if (prevBing === undefined) delete process.env.BING_SEARCH_KEY;
      else process.env.BING_SEARCH_KEY = prevBing;
      if (prevSerp === undefined) delete process.env.SERPAPI_API_KEY;
      else process.env.SERPAPI_API_KEY = prevSerp;
    }
  });
});
