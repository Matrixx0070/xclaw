import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { tryHandleMcpRoute } from "../src/gateway/routes/mcp.mjs";

// /mcp/oauth/callback is auth-exempt and renders text into HTML — the
// failure branch used to interpolate raw error text (which can carry a
// remote AS's error_description). Everything must be HTML-escaped.

function call(p, query) {
  let status = null;
  let body = "";
  return tryHandleMcpRoute({
    p,
    method: "GET",
    req: { headers: {}, url: p + "?" + query },
    res: {
      writeHead: (c) => { status = c; },
      end: (b) => { body += b || ""; },
    },
    url: new URL("http://x" + p + "?" + query),
    cfg: {},
    json: () => {},
    readBody: async () => ({}),
    mcpClient: { status: () => [] },
    mcpServer: {},
  }).then((handled) => ({ handled, status, body }));
}

describe("MCP OAuth callback XSS", () => {
  it("expired-state page never reflects markup", async () => {
    const { handled, status, body } = await call(
      "/mcp/oauth/callback",
      "state=%3Cscript%3Ealert(1)%3C%2Fscript%3E&code=x"
    );
    assert.equal(handled, true);
    assert.equal(status, 400);
    assert.ok(!body.includes("<script>alert(1)</script>"), "no raw markup reflected");
  });

  it("static strings render fine (sanity)", async () => {
    const { body } = await call("/mcp/oauth/callback", "state=nope&code=x");
    assert.match(body, /Login link expired/);
  });
});
