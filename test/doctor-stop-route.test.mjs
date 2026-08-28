/**
 * `gateway.stopRoute` must not answer a question it never asked.
 *
 * The probe decided whether POST /stop — the kill-switch — was mounted by
 * grepping `path.join(process.cwd(), "src/gateway/index.mjs")` for marker
 * strings. It was wrong in both directions at once:
 *
 *   • From the repo root, the routes extraction had moved the mount into
 *     `src/gateway/routes/stop.mjs`, so the grep found 0 markers and the row
 *     read `warn: gateway mount not detected` — while the live gateway
 *     answered `POST /stop -> 401`. A false alarm on the one route an operator
 *     has to be able to trust.
 *
 *   • From any other directory — which is every installed CLI, since `xclaw
 *     doctor` is run from wherever the operator stands — `existsSync` was
 *     false, the read never happened, and `mounted` kept its initial value
 *     `helperOk === true`. The row then read `ok: gateway mount markers
 *     present`: a positive claim about a file it had never opened. The check
 *     passed hardest exactly where it checked nothing.
 *
 * The old tests asserted only `helperOk`, never `mounted` or the status, which
 * is how a fail-open shipped under a green suite. These pin the mount verdict
 * itself: the chain must be real, an orphan module must not fake it, and an
 * unread tree must never report ok.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import os from "node:os";

import {
  pushStopRouteChecks,
  stopRouteMounted,
  analyzeStopMount,
  describeStopMount,
  readGatewaySources,
} from "../src/cli/doctor-stop-route.mjs";

/** A dispatcher that imports the stop route module and calls it — the real shape. */
const WIRED_INDEX = `
import { tryHandleSecurityRoute } from "./routes/security.mjs";
import { tryHandleStopRoute } from "./routes/stop.mjs";
async function handle(req, res) {
  if (await tryHandleSecurityRoute(routeArgs)) return;
  if (await tryHandleStopRoute(routeArgs)) return;
}
`;
const STOP_MODULE = `
import { handleStopAll, isStopPath } from "../stop-route.mjs";
export async function tryHandleStopRoute({ path, req, res, cfg }) {
  if (!isStopPath(path)) return false;
  await handleStopAll(req, res, { cfg });
  return true;
}
`;

describe("stopRouteMounted scans one blob for the markers", () => {
  it("detects mount markers", () => {
    assert.equal(stopRouteMounted("handleStopAll(req, res)"), true);
    assert.equal(stopRouteMounted("nope"), false);
  });
});

describe("analyzeStopMount requires the whole chain, not a filename", () => {
  it("follows dispatcher → route module and names the file it found", () => {
    const r = analyzeStopMount({ "index.mjs": WIRED_INDEX, "routes/stop.mjs": STOP_MODULE });
    assert.equal(r.mounted, true);
    assert.equal(r.via, "routes/stop.mjs");
  });

  it("still recognises a mount written inline in the dispatcher", () => {
    // The pre-extraction layout. The fix must not break the shape it replaced.
    const r = analyzeStopMount({ "index.mjs": 'if (isStopPath(p)) return handleStopAll(req, res);' });
    assert.equal(r.mounted, true);
    assert.equal(r.via, "index.mjs");
  });

  it("does NOT call an ORPHANED stop module a mount", () => {
    // The exact failure a marker-grep cannot see: the module exists, exports
    // correctly, carries every marker — and nothing routes to it. A refactor
    // that drops one import line leaves the kill-switch dead, and the operator
    // must not be told it is wired.
    const r = analyzeStopMount({
      "index.mjs": 'import { tryHandleOpsRoute } from "./routes/ops.mjs";\nawait tryHandleOpsRoute(a);',
      "routes/stop.mjs": STOP_MODULE,
    });
    assert.equal(r.mounted, false, "an unreachable stop module was reported as mounted");
  });

  it("does NOT accept an import the dispatcher never calls", () => {
    const importedNeverCalled = 'import { tryHandleStopRoute } from "./routes/stop.mjs";\n// TODO: wire\n';
    const r = analyzeStopMount({
      "index.mjs": importedNeverCalled,
      "routes/stop.mjs": STOP_MODULE,
    });
    assert.equal(r.mounted, false, "a dead import counted as a live route");
  });

  it("reports UNKNOWN — never false, never true — when the dispatcher cannot be read", () => {
    for (const sources of [{}, { "routes/stop.mjs": STOP_MODULE }, { "index.mjs": "" }]) {
      const r = analyzeStopMount(sources);
      assert.equal(r.mounted, null, "guessed a verdict from sources it never read");
    }
  });

  it("accepts a Map as well as a plain object", () => {
    const m = new Map([
      ["index.mjs", WIRED_INDEX],
      ["routes/stop.mjs", STOP_MODULE],
    ]);
    assert.equal(analyzeStopMount(m).mounted, true);
  });
});

describe("describeStopMount never turns 'unknown' into 'ok'", () => {
  it("is ok only for a confirmed mount, and says which file carries it", () => {
    const d = describeStopMount(true, { mounted: true, via: "routes/stop.mjs" });
    assert.equal(d.status, "ok");
    assert.match(d.message, /routes\/stop\.mjs/);
  });

  it("warns — not ok — when the sources could not be read", () => {
    // The fail-open, pinned. `mounted` used to default to `helperOk`, so this
    // case printed "gateway mount markers present".
    const d = describeStopMount(true, { mounted: null, reason: "gateway sources unreadable" });
    assert.equal(d.status, "warn");
    assert.match(d.message, /NOT verified/);
    assert.equal(/markers present/.test(d.message), false);
  });

  it("warns when the mount is genuinely absent", () => {
    const d = describeStopMount(true, { mounted: false });
    assert.equal(d.status, "warn");
    assert.match(d.message, /not detected/);
  });

  it("errors when the helper itself is missing", () => {
    assert.equal(describeStopMount(false, { mounted: true }).status, "error");
  });
});

describe("readGatewaySources resolves against the module, not the cwd", () => {
  it("reads the dispatcher and its route modules from an unrelated cwd", async () => {
    // The installed-CLI case. cwd-relative resolution read nothing here, and
    // the probe reported ok anyway.
    const prev = process.cwd();
    try {
      process.chdir(os.tmpdir());
      const sources = await readGatewaySources();
      assert.ok(sources, "gateway sources unreadable outside the repo root");
      assert.ok(sources["index.mjs"], "dispatcher not found");
      assert.ok(Object.keys(sources).some((k) => k.startsWith("routes/")), "route modules not found");
    } finally {
      process.chdir(prev);
    }
  });
});

describe("pushStopRouteChecks reports this repo's real wiring", () => {
  it("confirms the mount instead of warning about the extraction", async () => {
    const checks = [];
    const r = await pushStopRouteChecks((id, status, message, extra) =>
      checks.push({ id, status, message, extra })
    );
    assert.equal(checks.length, 1, "one row per key");
    assert.equal(checks[0].id, "gateway.stopRoute");
    assert.equal(checks[0].extra.helperOk, true);
    // The live gateway answers POST /stop -> 401. Anything but ok here is the
    // false alarm this slice removed.
    assert.equal(checks[0].status, "ok", `stop mount not detected: ${checks[0].message}`);
    assert.equal(r.mounted, true);
    assert.ok(r.via, "a confirmed mount must name the file that carries it");
  });

  it("gives the same verdict from an unrelated cwd", async () => {
    const prev = process.cwd();
    try {
      process.chdir(os.tmpdir());
      const checks = [];
      await pushStopRouteChecks((id, status, message, extra) => checks.push({ status, extra }));
      assert.equal(checks[0].status, "ok");
      assert.equal(checks[0].extra.mounted, true, "verdict depended on the cwd");
    } finally {
      process.chdir(prev);
    }
  });
});
