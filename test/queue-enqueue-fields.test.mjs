/**
 * A refusal the caller cannot see is a defect, and the docs invited it.
 *
 * `pickEnqueueRequest()` is the shape POST /queue and `xclaw queue batch` are
 * allowed to send. It deliberately withholds the retry and admission ceilings:
 * a request body that could set `maxWaitMs: 10**9` would never be abandoned,
 * and `maxAttempts: 99` is a re-run lever. That boundary is correct and is
 * pinned by queue-abandon.test.mjs and queue-cli-owner.test.mjs.
 *
 * What was wrong is that nothing said so where a caller looks. docs/QUEUE.md
 * advertised `maxAttempts?` in the POST body, and the route answered 202 with
 * a job id and no mention that the field had been dropped. Measured against
 * the running 3.359.0 gateway, posting exactly the documented body:
 *
 *   POST /queue {"goal":...,"maxAttempts":5,"maxWaitMs":999000}
 *     -> stored maxAttempts: 1, maxWaitMs: 300000, response 202, no signal
 *
 * So an operator followed the shipped docs, asked for five attempts, and got a
 * job that dead-letters on its first failure — with nothing anywhere to tell
 * them why. The boundary stays; it just stops being invisible.
 *
 * The drift case partitions rather than enumerates. Every `item.<key>` that
 * enqueueJob reads must be either forwarded or named in WITHHELD_REQUEST_FIELDS
 * with a reason. A field added to enqueueJob and forgotten in the picker fails
 * here, and so does a ceiling that quietly becomes caller-settable — the same
 * principle as grading approvals against ROLE_TOOL_PACKS: classify against
 * something that cannot silently omit.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  pickEnqueueRequest,
  WITHHELD_REQUEST_FIELDS,
  withheldRequestFields,
  pauseQueue,
} from "../src/jobs/queue.mjs";
import { tryHandleEvalQueueRoute } from "../src/gateway/routes/eval-queue.mjs";

const SRC = fs.readFileSync(new URL("../src/jobs/queue.mjs", import.meta.url), "utf8");
const DOC = fs.readFileSync(new URL("../docs/QUEUE.md", import.meta.url), "utf8");

/** Body text of a top-level `export function NAME(` / `export async function NAME(`. */
function functionBody(name) {
  const start = SRC.search(new RegExp(`export (?:async )?function ${name}\\(`));
  assert.ok(start >= 0, `${name} not found in queue.mjs`);
  const open = SRC.indexOf("{", start);
  let depth = 0;
  for (let i = open; i < SRC.length; i++) {
    if (SRC[i] === "{") depth++;
    else if (SRC[i] === "}" && --depth === 0) return SRC.slice(open, i + 1);
  }
  throw new Error(`unbalanced braces in ${name}`);
}

/** Every `item.<key>` enqueueJob reads, including via resolvePriority(item). */
function acceptedFields() {
  const text = functionBody("enqueueJob") + functionBody("resolvePriority");
  return [...new Set([...text.matchAll(/\bitem\.([A-Za-z][A-Za-z0-9]*)/g)].map((m) => m[1]))];
}

describe("the enqueue request boundary is visible, not just enforced", () => {
  it("still withholds the ceilings a request body must not set", () => {
    const picked = pickEnqueueRequest({ goal: "g", maxAttempts: 99, maxWaitMs: 10 ** 9 });
    assert.equal(picked.maxAttempts, undefined, "retry budget is config-owned");
    assert.equal(picked.maxWaitMs, undefined, "admission wait is config-owned");
  });

  it("names which withheld fields a body actually tried to set", () => {
    assert.deepEqual(withheldRequestFields({ goal: "g" }), []);
    assert.deepEqual(withheldRequestFields({ goal: "g", maxAttempts: 5 }), ["maxAttempts"]);
    assert.deepEqual(
      withheldRequestFields({ goal: "g", maxAttempts: 5, maxWaitMs: 1 }).sort(),
      ["maxAttempts", "maxWaitMs"]
    );
    // A field left unset was not "tried"; only an explicit value is reported.
    assert.deepEqual(withheldRequestFields({ goal: "g", maxAttempts: undefined }), []);
  });

  it("gives every withheld field a reason a caller can act on", () => {
    for (const [field, reason] of Object.entries(WITHHELD_REQUEST_FIELDS)) {
      assert.equal(typeof reason, "string", `${field} needs a reason`);
      assert.ok(reason.length > 8, `${field}'s reason is not usable: ${reason}`);
    }
  });

  it("classifies every field enqueueJob reads as forwarded or withheld", () => {
    const forwarded = new Set(Object.keys(pickEnqueueRequest({ goal: "g" })));
    const withheld = new Set(Object.keys(WITHHELD_REQUEST_FIELDS));
    const unclassified = acceptedFields().filter((k) => !forwarded.has(k) && !withheld.has(k));
    assert.deepEqual(
      unclassified,
      [],
      `enqueueJob reads item.{${unclassified.join(",")}}: forward it, or name it in WITHHELD_REQUEST_FIELDS with a reason`
    );
  });

  it("does not let the docs advertise a field the route refuses", () => {
    const row = DOC.split("\n").find((l) => l.includes("| `/queue` |") && l.includes("POST"));
    assert.ok(row, "docs/QUEUE.md no longer documents POST /queue");
    const advertised = [...row.matchAll(/([A-Za-z][A-Za-z0-9]*)\??[,}]/g)].map((m) => m[1]);
    const lies = advertised.filter((f) => f in WITHHELD_REQUEST_FIELDS);
    assert.deepEqual(lies, [], `docs promise ${lies.join(",")} on a route that drops it`);
  });
});

/**
 * The route is where a caller finds out. A 202 carrying only the stored record
 * looks identical whether the request was honoured in full or quietly trimmed,
 * which is how the docs' `maxAttempts?` survived: nothing ever contradicted it.
 */
describe("POST /queue tells the caller what it refused", () => {
  const route = async (body) => {
    const dir = await fsp.mkdtemp(path.join(os.tmpdir(), "xclaw-withheld-q-"));
    const cfg = { paths: { configDir: dir }, agent: { maxTurns: 1 } };
    pauseQueue(); // the route arms the worker; park it so nothing runs
    let sent = null;
    const handled = await tryHandleEvalQueueRoute({
      p: "/queue",
      method: "POST",
      req: { headers: {} },
      res: {},
      url: new URL("http://local/queue"),
      cfg,
      json: (_res, status, b) => {
        sent = { status, body: b };
      },
      readBody: async () => body,
    });
    assert.equal(handled, true);
    await fsp.rm(dir, { recursive: true, force: true });
    return sent;
  };

  it("names the refused field and why, instead of a silent 202", async () => {
    const sent = await route({ goal: "ship it", maxAttempts: 5 });
    assert.equal(sent.status, 202);
    assert.equal(sent.body.maxAttempts, 1, "the ceiling still came from config");
    assert.deepEqual(
      sent.body.withheld,
      [{ field: "maxAttempts", reason: WITHHELD_REQUEST_FIELDS.maxAttempts }],
      "a caller following the old docs must hear that the field was dropped"
    );
  });

  it("stays silent for a request that asked for nothing it cannot have", async () => {
    const sent = await route({ goal: "ship it", priority: 3 });
    assert.equal(sent.status, 202);
    assert.ok(!("withheld" in sent.body), "no noise for a well-formed caller");
  });
});
