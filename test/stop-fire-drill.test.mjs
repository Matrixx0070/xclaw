/**
 * The kill-switch fire-drill must reach the same verdict from any directory.
 *
 * Ten of its eleven steps run in process; `tls_parity` reads a source file, and
 * it used to resolve that file against a caller-supplied `root` defaulting to
 * `process.cwd()`. This test — and every other caller — dutifully computed the
 * repo root and handed it in, so the suite only ever exercised the one cwd
 * where the bug could not appear. From an installed CLI the drill reported
 * `failed: tls_parity` on a healthy install, which `xclaw doctor` printed as a
 * warn, or as an ERROR under a prod/strict/requireAuth profile.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  runStopFireDrill,
  fireDrillTlsParity,
  defaultTlsPath,
} from "../src/eval/stop-fire-drill.mjs";

describe("single-port stop fire-drill", () => {
  it("passes HTTP + HMAC canonical + WS + SSE + TLS + dry-run", async () => {
    const r = await runStopFireDrill();
    if (!r.ok) {
      console.error(JSON.stringify(r, null, 2));
    }
    assert.equal(r.ok, true, `failed: ${(r.failed || []).join(",")}`);
    const canon = r.steps.find((s) => s.name === "http_hmac_canonical");
    assert.ok(canon);
    assert.equal(canon.authMethod, "hmac");
    const sse = r.steps.find((s) => s.name === "sse_signed");
    assert.ok(sse, "missing sse_signed step");
    assert.equal(sse.channel, "sse");
    assert.ok(sse.authMethod);
  });

  it("passes from an unrelated cwd — the installed-CLI case", async () => {
    const prev = process.cwd();
    try {
      process.chdir(os.tmpdir());
      const r = await runStopFireDrill();
      assert.equal(
        r.ok,
        true,
        `drill verdict depended on the cwd: ${(r.failed || []).join(",")}`
      );
    } finally {
      process.chdir(prev);
    }
  });
});

describe("fireDrillTlsParity resolves against the module, not the cwd", () => {
  it("finds the real TLS listener regardless of where it is called from", () => {
    const prev = process.cwd();
    try {
      process.chdir(os.tmpdir());
      assert.equal(fireDrillTlsParity().ok, true);
    } finally {
      process.chdir(prev);
    }
    assert.equal(
      defaultTlsPath(),
      path.resolve(
        path.dirname(fileURLToPath(import.meta.url)),
        "../src/gateway/tls.mjs"
      )
    );
  });

  it("still fails — with a distinguishable reason — on a real parity breach", () => {
    // The check must keep its teeth: a TLS listener that does not route /stop
    // through the shared proxy leaves the kill-switch reachable on one port
    // and dead on the other.
    const f = path.join(
      fs.mkdtempSync(path.join(os.tmpdir(), "xclaw-drill-")),
      "tls.mjs"
    );
    fs.writeFileSync(f, "export function createTlsServer() { /* no stop wire */ }\n");
    const breach = fireDrillTlsParity(f);
    assert.equal(breach.ok, false);
    assert.equal(breach.reason, "markers_absent");

    const absent = fireDrillTlsParity(path.join(path.dirname(f), "nope.mjs"));
    assert.equal(absent.ok, false);
    assert.equal(absent.reason, "missing_tls_mjs", "unreadable and unwired must not look alike");
  });
});
