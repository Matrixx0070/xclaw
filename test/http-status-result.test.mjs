import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { httpStatusResult } from "../src/tools/connected-tools.mjs";

describe("httpStatusResult", () => {
  it("2xx is success", () => {
    const r = httpStatusResult({ ok: true, status: 200 }, '{"ok":true}');
    assert.ok(!r.isError);
    assert.match(r.content[0].text, /HTTP 200/);
  });

  it("404 is isError, not a successful GitHub/HTTP body", () => {
    const r = httpStatusResult({ ok: false, status: 404 }, "Not Found");
    assert.equal(r.isError, true);
    assert.match(r.content[0].text, /HTTP 404/);
    assert.match(r.content[0].text, /Not Found/);
  });
});
