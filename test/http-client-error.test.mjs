/**
 * A caller-side mistake must answer 4xx, and NOTHING else may reach the wire.
 *
 * Found by live-driving the gateway: POST /channel/webchat/message with
 * `{text: "..."}` (the route wants `message`) answered HTTP 500. The harm is
 * concrete — utils/fetch-retry.mjs retries 500 by default, so this repo's own
 * client burns its full retry budget on a request that can never succeed, and
 * the 5xx rate operators page on climbs for a caller-side typo.
 *
 * The tests that matter here are the negative ones. `json(res, err.status || 500)`
 * would have "fixed" the 500 while leaking two upstream statuses to callers
 * (a server-side missing credential as 401, an upstream 429 as ours), so the
 * brand must be unforgeable and unrelated to `err.status`.
 */
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { clientError, badRequest, clientErrorStatus } from "../src/shared/http-error.mjs";
import { handleWebChatMessage } from "../src/channels/webchat/index.mjs";

const SRC = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "src");

function walk(dir) {
  const out = [];
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) out.push(...walk(full));
    else if (e.name.endsWith(".mjs")) out.push(full);
  }
  return out;
}

describe("client errors answer 4xx", () => {
  test("a branded error carries its status", () => {
    assert.equal(clientErrorStatus(badRequest("message is required")), 400);
    assert.equal(clientErrorStatus(clientError("nope", 404)), 404);
    assert.equal(clientErrorStatus(clientError("too big", 413)), 413);
    assert.equal(badRequest("m").message, "m");
    assert.ok(badRequest("m") instanceof Error);
  });

  test("only 4xx can be branded", () => {
    for (const bad of [500, 200, 399, 600, 400.5, "400", null, NaN]) {
      assert.throws(() => clientError("x", bad), /must be 4xx/, `accepted ${bad}`);
    }
    // An omitted status is the documented 400 default, not a rejected value.
    assert.equal(clientErrorStatus(clientError("x", undefined)), 400);
  });

  test("anything unbranded falls back to 500", () => {
    for (const v of [new Error("boom"), null, undefined, "string", 400, {}]) {
      assert.equal(clientErrorStatus(v), null, `${String(v)} was treated as a client error`);
    }
  });

  // The trap the naive fix falls into. Both of these reach a gateway catch.
  test("an upstream err.status is NOT echoed to the caller", () => {
    // providers/failover-router.mjs:124 — "No credentials for <model>". This is
    // a SERVER misconfiguration; answering 401 sends the caller off to
    // re-authenticate a token that was never the problem.
    const noCreds = new Error("No credentials for grok-4.6");
    noCreds.status = 401;
    assert.equal(clientErrorStatus(noCreds), null, "server-side 401 leaked to the caller");

    // agent/provider.mjs:239 — the upstream provider's own status. Echoing it
    // makes an upstream rate limit look like ours.
    for (const upstream of [429, 503, 502, 400, 404]) {
      const err = new Error("upstream");
      err.status = upstream;
      assert.equal(clientErrorStatus(err), null, `upstream ${upstream} leaked`);
    }
  });

  test("the brand cannot be forged by a caller", () => {
    // A body a client controls, however shaped.
    assert.equal(clientErrorStatus({ status: 400 }), null);
    assert.equal(clientErrorStatus({ "xclaw.clientError": 400 }), null);
    assert.equal(clientErrorStatus({ [Symbol.for("xclaw.clientError")]: 400 }), null);

    // The brand is non-enumerable, so it does not survive serialisation — an
    // error round-tripped through a queue or a worker arrives unbranded.
    const branded = badRequest("m");
    assert.equal(clientErrorStatus(JSON.parse(JSON.stringify(branded))), null);
    assert.equal(clientErrorStatus({ ...branded }), null);
    assert.equal(clientErrorStatus(structuredClone({ ...branded })), null);
    assert.deepEqual(Object.keys(branded), [], "brand is enumerable");
  });

  test("the webchat route brands its own input validation", async () => {
    for (const message of [undefined, null, "", "   ", 42, {}]) {
      const err = await handleWebChatMessage({ message, cfg: {} }).then(
        () => null,
        (e) => e
      );
      assert.ok(err, `no throw for ${JSON.stringify(message)}`);
      assert.equal(clientErrorStatus(err), 400, `not a 400 for ${JSON.stringify(message)}`);
    }
  });

  // Behaviour above is only reachable if the catches consult it. This pins the
  // wiring itself: a future catch added with a bare 500 regresses the whole
  // surface silently, and the suite would stay green without this.
  // Scoped to 500 deliberately. A 502/503 names WHICH dependency failed
  // (`telegram_disabled`, `computer unreachable`, a remote worker) and is an
  // honest classification; 500 is the one that collapses every error class,
  // caller-side included, into "the server broke".
  test("no gateway response hard-codes 500", () => {
    const offenders = [];
    for (const file of walk(path.join(SRC, "gateway"))) {
      const src = fs.readFileSync(file, "utf8");
      src.split("\n").forEach((line, i) => {
        if (/json\(\s*res\s*,\s*500\s*,/.test(line)) {
          offenders.push(`${path.relative(SRC, file)}:${i + 1} ${line.trim()}`);
        }
      });
    }
    assert.deepEqual(
      offenders,
      [],
      "a gateway response hard-codes 500 instead of `clientErrorStatus(err) ?? 500` — " +
        `a caller-side error there is reported as a server failure:\n  ${offenders.join("\n  ")}`
    );
  });

  test("every gateway catch that can answer 500 routes through the brand", () => {
    const wired = [];
    for (const file of walk(path.join(SRC, "gateway"))) {
      const src = fs.readFileSync(file, "utf8");
      const uses = (src.match(/clientErrorStatus\(err\)\s*\?\?\s*500/g) || []).length;
      if (uses) {
        assert.match(
          src,
          /import \{ clientErrorStatus \} from ".*shared\/http-error\.mjs"/,
          `${path.relative(SRC, file)} uses clientErrorStatus without importing it`
        );
        wired.push([path.relative(SRC, file), uses]);
      }
    }
    // Not an exact count — new catches are expected. The floor pins that the
    // sites found live (webchat message, the outermost catch, agent/run) stay
    // wired rather than being reverted to a literal by a later refactor.
    const total = wired.reduce((n, [, c]) => n + c, 0);
    assert.ok(total >= 7, `only ${total} gateway catches honour the brand: ${JSON.stringify(wired)}`);
    assert.ok(
      wired.some(([f]) => f === "gateway/index.mjs"),
      "the outermost gateway catch is not wired"
    );
  });
});
