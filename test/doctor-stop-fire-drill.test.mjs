/**
 * `ops.stop_fire_drill` must not raise a kill-switch alarm about the cwd.
 *
 * The probe passed `opts.root || process.cwd()` into the drill, whose one
 * on-disk step then looked for `<cwd>/src/gateway/tls.mjs`. This test passed
 * `{ root }` — the repo root — and asserted only that the status was one of
 * ok/warn/error, so it was green whichever verdict came back. Meanwhile an
 * operator running `xclaw doctor` from anywhere else got
 * `stop fire-drill failed: tls_parity`, escalated to ERROR under a
 * prod/strict/requireAuth profile.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import os from "node:os";
import {
  pushStopFireDrillChecks,
  describeFailedSteps,
} from "../src/cli/doctor-stop-fire-drill.mjs";

async function runFrom(dir, cfg = {}) {
  const prev = process.cwd();
  const checks = [];
  try {
    process.chdir(dir);
    await pushStopFireDrillChecks(
      (id, status, msg, extra) => checks.push({ id, status, msg, extra }),
      cfg
    );
  } finally {
    process.chdir(prev);
  }
  return checks;
}

describe("doctor ops.stop_fire_drill", () => {
  it("passes, and gives the same verdict from an unrelated cwd", async () => {
    const here = await runFrom(process.cwd());
    assert.equal(here[0].id, "ops.stop_fire_drill");
    assert.equal(here[0].status, "ok", here[0].msg);

    const away = await runFrom(os.tmpdir());
    assert.equal(
      away[0].status,
      "ok",
      `kill-switch alarm raised by the working directory: ${away[0].msg}`
    );
    assert.deepEqual(away[0].extra.failed, []);
  });

  it("does not turn a healthy install into a prod ERROR from the wrong cwd", async () => {
    // The worst version of the bug: profile prod promotes the phantom failure
    // from warn to error, so the loudest row in `xclaw doctor` on a production
    // box was about nothing.
    const away = await runFrom(os.tmpdir(), { profile: "prod" });
    assert.equal(away[0].status, "ok", away[0].msg);
  });
});

describe("describeFailedSteps says why, not just which", () => {
  it("appends each failed step's reason", () => {
    const steps = [
      { name: "paths", ok: false },
      { name: "tls_parity", ok: false, reason: "markers_absent" },
    ];
    assert.equal(
      describeFailedSteps(steps, ["paths", "tls_parity"]),
      "paths,tls_parity(markers_absent)"
    );
  });

  it("distinguishes an unreadable file from a real parity breach", () => {
    const unread = describeFailedSteps(
      [{ name: "tls_parity", ok: false, reason: "missing_tls_mjs" }],
      ["tls_parity"]
    );
    const breach = describeFailedSteps(
      [{ name: "tls_parity", ok: false, reason: "markers_absent" }],
      ["tls_parity"]
    );
    assert.notEqual(unread, breach, "two very different incidents read identically");
  });

  it("falls back to 'unknown' rather than an empty message", () => {
    assert.equal(describeFailedSteps([], []), "unknown");
  });
});
