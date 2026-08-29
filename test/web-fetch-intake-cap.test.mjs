/**
 * web_fetch must bound what it pulls off the wire, not just what it returns.
 *
 * `max_chars` is applied after `await res.text()` — by which point the entire
 * body is already resident in the gateway process. The model chooses the URL,
 * so without an intake cap a single large link buys unbounded memory for a
 * hundred-character answer.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { createWebFetchTool, webFetchIntakeCap } from "../src/tools/extra-tools.mjs";

const MiB = 1 << 20;
const cfg = { security: { ssrf: { allowPrivate: true } } };

/** Serve `totalMiB` of filler, reporting how many bytes we actually wrote. */
function bigServer(totalMiB) {
  const chunk = Buffer.alloc(MiB, 0x61);
  const state = { served: 0 };
  const server = http.createServer((req, res) => {
    res.writeHead(200, { "content-type": "text/plain" });
    let i = 0;
    const pump = () => {
      while (i < totalMiB) {
        if (res.destroyed || res.writableEnded) return;
        i++;
        state.served += chunk.length;
        if (!res.write(chunk)) return res.once("drain", pump);
      }
      res.end();
    };
    pump();
  });
  return { server, state };
}

function listen(server) {
  return new Promise((resolve) => server.listen(0, "127.0.0.1", () => resolve(server.address().port)));
}

describe("web_fetch intake cap", () => {
  it("scales the byte budget with the requested character budget", () => {
    // Markup and entities mean the source is bigger than the text pulled out
    // of it, so the budget is a multiple of the answer — not equal to it.
    assert.ok(webFetchIntakeCap(200_000) > webFetchIntakeCap(10_000));
    assert.equal(webFetchIntakeCap(200_000), 200_000 * 20);
  });

  it("keeps a floor so a small max_chars still fetches a real page", () => {
    for (const input of [1, 100, 0, -5, undefined, NaN, "nonsense"]) {
      assert.ok(
        webFetchIntakeCap(input) >= 262_144,
        `intake budget collapsed for max_chars=${String(input)}`
      );
    }
  });

  it("is self-bounding — an absurd max_chars cannot widen it without limit", () => {
    assert.equal(webFetchIntakeCap(1e9), webFetchIntakeCap(200_000));
  });

  it("stops reading a huge body instead of buffering all of it", async () => {
    const { server, state } = bigServer(64);
    const port = await listen(server);
    try {
      const tool = createWebFetchTool({ cfg });
      const out = await tool.execute({ url: `http://127.0.0.1:${port}/big`, max_chars: 100 });
      assert.ok(out && !out.isError, `web_fetch failed: ${JSON.stringify(out).slice(0, 200)}`);
      // 64 MiB was on offer for a 100-character answer. Anything close to that
      // means the cap is being applied after the body is already in memory.
      assert.ok(
        state.served < 16 * MiB,
        `web_fetch drained ${(state.served / MiB).toFixed(1)} MiB for a 100-char request`
      );
    } finally {
      server.close();
    }
  });

  it("still returns a small page in full", async () => {
    const body = "<html><body><p>hello sandbox</p></body></html>";
    const server = http.createServer((req, res) => {
      res.writeHead(200, { "content-type": "text/html" });
      res.end(body);
    });
    const port = await listen(server);
    try {
      const tool = createWebFetchTool({ cfg });
      const out = await tool.execute({ url: `http://127.0.0.1:${port}/small` });
      const text = out?.content?.[0]?.text || "";
      assert.match(text, /hello sandbox/, "an ordinary page stopped coming through intact");
    } finally {
      server.close();
    }
  });
});
