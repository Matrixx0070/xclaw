import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";

// The control UI's Pairing panel called /pairing/pending|approve|revoke since
// it shipped — the routes never existed (5th dead-route family, found by the
// 3.96.0 endpoint sweep). They live in routes/security.mjs; the gateway
// dispatches both /security/* AND /pairing/* to that module.
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), "xclaw-pairing-"));
const SAVED_HOME = process.env.HOME;
const SAVED_PAIRING_FILE = process.env.XCLAW_PAIRING_FILE;
process.env.HOME = TMP;
delete process.env.XCLAW_PAIRING_FILE;

const { tryHandleSecurityRoute } = await import("../src/gateway/routes/security.mjs");
const { createPairingStore } = await import("../src/pairing/pairing-store.mjs");

after(() => {
  process.env.HOME = SAVED_HOME;
  if (SAVED_PAIRING_FILE === undefined) delete process.env.XCLAW_PAIRING_FILE;
  else process.env.XCLAW_PAIRING_FILE = SAVED_PAIRING_FILE;
  fs.rmSync(TMP, { recursive: true, force: true });
});

function call(p, method, body) {
  let out = null, status = null;
  return tryHandleSecurityRoute({
    p, method,
    req: { headers: {}, url: p + (method === "GET" ? "?channel=telegram" : "") },
    res: {},
    cfg: { paths: { configDir: TMP } },
    approvalGate: null,
    json: (_r, c, payload) => { status = c; out = payload; },
    readBody: async () => body || {},
  }).then((handled) => ({ handled, status, out }));
}

describe("pairing routes", () => {
  it("pending lists empty store", async () => {
    const { handled, status, out } = await call("/pairing/pending", "GET");
    assert.equal(handled, true);
    assert.equal(status, 200);
    assert.deepEqual(out.pending, []);
    assert.deepEqual(out.approved, []);
  });

  it("approve → listed as approved → revoke removes", async () => {
    const store = createPairingStore({ cfg: { paths: { configDir: TMP } } });
    const req = store.upsertPairingRequest({ channel: "telegram", id: "555", meta: {} });
    assert.ok(req.code);

    const apr = await call("/pairing/approve", "POST", { channel: "telegram", code: req.code });
    assert.equal(apr.status, 200);
    assert.equal(apr.out.ok, true);
    assert.equal(apr.out.senderId, "555");

    const list = await call("/pairing/pending", "GET");
    assert.equal(list.out.approved.length, 1);
    assert.equal(list.out.approved[0].id, "555");

    const rev = await call("/pairing/revoke", "POST", { channel: "telegram", senderId: "555" });
    assert.equal(rev.out.removed, 1);
  });

  it("approve unknown code → 404", async () => {
    const { status, out } = await call("/pairing/approve", "POST", { channel: "telegram", code: "nope" });
    assert.equal(status, 404);
    assert.equal(out.ok, false);
  });
});
