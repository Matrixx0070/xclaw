/**
 * `doctor-swarm-ledger.mjs` was written, tested by nothing, and never
 * imported by any production module — so the two rows it pushes have never
 * appeared in `xclaw doctor` output (proven live: 134 rows, neither present).
 *
 * That matters because of what it is the ONLY reader of. `reserveUsd` takes a
 * file lease on the hot swarm path (`acquireLease`, ledger-lease.mjs), and
 * `readLease` — the sole way to see who holds it and whether it has expired —
 * had exactly one consumer in the whole repo: this dead module. A lease left
 * held by a crashed gateway denies every cross-process reserve with
 * SWARM_LEDGER_LEASE_HELD and no surface anywhere says so.
 *
 * The bundle is doctor's single owner for these inserts; doctor.mjs carries a
 * standing warning that re-invoking a probe there printed every verdict twice
 * and inflated the count doctor exits on. Hence the duplicate-id assertion.
 */
import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { pushDoctorOpsBundle } from "../src/cli/doctor-ops-bundle.mjs";

let dir;
before(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "xclaw-ledgerwire-"));
});
after(() => {
  try {
    fs.rmSync(dir, { recursive: true, force: true });
  } catch {
    /* */
  }
});

function today() {
  return new Date().toISOString().slice(0, 10);
}

function writeLedger(spentUsd, reservedUsd) {
  fs.writeFileSync(
    path.join(dir, "swarm-cost-ledger.json"),
    JSON.stringify({ day: today(), account: "default", spentUsd, reservedUsd, entries: [] })
  );
}

function writeLease(owner, expiresAt) {
  fs.writeFileSync(
    path.join(dir, "swarm-ledger.lease"),
    JSON.stringify({ owner, at: Date.now(), expiresAt })
  );
}

function clearLease() {
  try {
    fs.unlinkSync(path.join(dir, "swarm-ledger.lease"));
  } catch {
    /* */
  }
}

async function runBundle(cfg = {}) {
  const rows = [];
  await pushDoctorOpsBundle(
    (id, status, message, detail) => rows.push({ id, status, message, detail }),
    { paths: { configDir: dir }, seats: { enabled: false }, ...cfg },
    { root: dir }
  );
  return rows;
}

const row = (rows, id) => rows.find((r) => r.id === id);

describe("doctor reports the swarm ledger it already guards", () => {
  it("emits both ledger rows", async () => {
    writeLedger(0, 0);
    clearLease();
    const rows = await runBundle();
    assert.ok(row(rows, "cost.swarmLedger"), "cost.swarmLedger missing from doctor");
    assert.ok(row(rows, "cost.swarmLedgerLease"), "cost.swarmLedgerLease missing from doctor");
  });

  it("reads the real ledger file, not a placeholder", async () => {
    writeLedger(30, 0);
    clearLease();
    const r = row(await runBundle({ cost: { dailyHardUsd: 60 } }), "cost.swarmLedger");
    assert.equal(r.status, "ok");
    assert.equal(r.detail.hardUsd, 60);
    assert.equal(r.detail.spentUsd, 30);
    assert.equal(r.detail.pressure, 0.5);
  });

  it("warns when the day's cap is nearly committed", async () => {
    writeLedger(59, 0.9);
    clearLease();
    const r = row(await runBundle({ cost: { dailyHardUsd: 60 } }), "cost.swarmLedger");
    assert.equal(r.status, "warn");
  });

  it("reports no lease when none is held", async () => {
    writeLedger(0, 0);
    clearLease();
    const r = row(await runBundle(), "cost.swarmLedgerLease");
    assert.equal(r.status, "ok");
    assert.match(r.message, /no ledger lease held/);
  });

  it("names the holder of a live lease", async () => {
    writeLedger(0, 0);
    writeLease("gw-4242", Date.now() + 30_000);
    const r = row(await runBundle(), "cost.swarmLedgerLease");
    assert.equal(r.status, "ok");
    assert.match(r.message, /gw-4242/);
    assert.doesNotMatch(r.message, /EXPIRED/);
  });

  it("warns on a lease left behind by a dead holder", async () => {
    writeLedger(0, 0);
    writeLease("gw-dead", Date.now() - 60_000);
    const r = row(await runBundle(), "cost.swarmLedgerLease");
    assert.equal(r.status, "warn");
    assert.match(r.message, /EXPIRED/);
    assert.equal(r.detail.owner, "gw-dead");
  });

  it("adds no duplicate row ids", async () => {
    writeLedger(0, 0);
    clearLease();
    const ids = (await runBundle()).map((r) => r.id);
    assert.deepEqual(
      ids.filter((id, i) => ids.indexOf(id) !== i),
      [],
      "a probe is wired in two owners — doctor would print its verdict twice"
    );
  });
});
