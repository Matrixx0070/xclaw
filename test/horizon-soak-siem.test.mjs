import { describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  appendSoakEvent,
  readSoakEvents,
  verifySoakEvent,
  signSoakEvent,
  exportSoakSiemBundle,
  resetSoakSiemExport,
  getSoakSiemExportTotal,
  resetSoakSiemHmacFail,
  getSoakSiemHmacFailTotal,
} from "../src/eval/horizon-soak-siem.mjs";
import {
  acquireSiemCursorLease,
  releaseSiemCursorLease,
} from "../src/eval/horizon-soak-siem-cursor.mjs";
import { acquireSoakLease } from "../src/eval/horizon-soak-lease.mjs";
import { recordSoakSiem } from "../src/eval/horizon-soak-siem-hook.mjs";
import { doctorHorizon } from "../src/cli/doctor-horizon.mjs";

describe("horizon soak siem", () => {
  it("signs, verifies, rotation previous secret", async () => {
    const base = await fs.mkdtemp(path.join(os.tmpdir(), "xclaw-siem-"));
    const cfg = { soak: { hmacSecret: "s1", hmacSecretPrevious: "s0" } };
    const ev = await appendSoakEvent(
      { type: "resume", jobId: "j1", owner: "n1" },
      { base, cfg }
    );
    assert.ok(ev.sig);
    assert.equal(verifySoakEvent(ev, cfg).ok, true);
    const old = signSoakEvent(
      {
        at: ev.at,
        type: ev.type,
        jobId: ev.jobId,
        owner: ev.owner,
        code: ev.code,
      },
      { soak: { hmacSecret: "s0" } }
    );
    assert.equal(
      verifySoakEvent(old, {
        soak: { hmacSecret: "s1", hmacSecretPrevious: "s0" },
      }).ok,
      true
    );
    resetSoakSiemHmacFail();
    const bad = { ...ev, sig: "00".repeat(32) };
    assert.equal(verifySoakEvent(bad, cfg).ok, false);
    assert.ok(getSoakSiemHmacFailTotal() >= 1);
  });

  it("bundle header + cursor lease exclusivity", async () => {
    const base = await fs.mkdtemp(path.join(os.tmpdir(), "xclaw-siem2-"));
    const cfg = { soak: { hmacSecret: "k" } };
    await appendSoakEvent({ type: "lease_acquired", jobId: "j2" }, { base, cfg });
    resetSoakSiemExport();
    const bundle = await exportSoakSiemBundle({ base, cfg });
    assert.ok(bundle.header.sig);
    assert.equal(bundle.header.count, 1);
    assert.ok(getSoakSiemExportTotal() >= 1);
    const a = acquireSiemCursorLease({ base, owner: "exp-1", ttlMs: 60_000 });
    assert.equal(a.ok, true);
    const b = acquireSiemCursorLease({ base, owner: "exp-2", ttlMs: 60_000 });
    assert.equal(b.ok, false);
    assert.equal(b.code, "CURSOR_LEASE_HELD");
    releaseSiemCursorLease({ base, owner: "exp-1", cursor: bundle.header.to });
  });

  it("denied lease writes signed event", async () => {
    const base = await fs.mkdtemp(path.join(os.tmpdir(), "xclaw-siem3-"));
    const cfg = { soak: { hmacSecret: "k" } };
    acquireSoakLease("denied-job", { base, owner: "holder", ttlMs: 60_000 });
    const rec = await recordSoakSiem(
      "lease_denied",
      { jobId: "denied-job", owner: "challenger", code: "LEASE_HELD" },
      { base, cfg }
    );
    assert.equal(rec.type, "lease_denied");
    assert.equal(verifySoakEvent(rec, cfg).ok, true);
    const evs = await readSoakEvents({ base });
    assert.ok(evs.some((e) => e.type === "lease_denied"));
  });

  it("doctor reports siem metrics", async () => {
    const d = await doctorHorizon({});
    assert.ok(d.metricsSiem);
    assert.equal(typeof d.siemHmacFail, "number");
  });
});
