import { describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

// `runDoctor` grew by appending probe call sites, and probes had also been
// grouped into doctor-ops-bundle.mjs — so four of the bundle's own probes were
// invoked a second time below the bundle call with identical arguments, and
// pushPerfChecks ran three times (once inside pushPerfChecksEnsured, twice
// directly). Every duplicate re-ran real work — ops.cold_start made three live
// health requests — and printed its verdict two or three times, inflating the
// warning count doctor reports and exits on.
//
// Running the real runDoctor here would mean live HTTP and live config, so this
// pins the invariant at the source instead: walk the probe call graph one hop
// out from runDoctor and assert no probe function is reachable twice.
const CLI_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "src", "cli");
const read = (f) => fs.readFileSync(path.join(CLI_DIR, f), "utf8");

// Both shapes appear: dynamic `const { fn } = await import("./doctor-x.mjs")`
// inside runDoctor's try/catch blocks, and a plain static import in the shims.
const DYNAMIC = /const\s*\{([^}]+)\}\s*=\s*await import\("\.\/(doctor-[\w-]+\.mjs)"\)/g;
const STATIC = /import\s*\{([^}]+)\}\s*from\s*"\.\/(doctor-[\w-]+\.mjs)"/g;

function invocations(source) {
  const found = [];
  for (const re of [DYNAMIC, STATIC]) {
    re.lastIndex = 0;
    for (const m of source.matchAll(re)) {
      const [, names, module] = m;
      for (const raw of names.split(",")) {
        const fn = raw.trim().split(/\s+as\s+/).pop().trim();
        // A name that is imported but never called is a re-export, not a probe.
        if (fn && new RegExp(`\\b${fn}\\s*\\(`).test(source)) found.push(`${module}:${fn}`);
      }
    }
  }
  return found;
}

// runDoctor only — later helpers (doctorGroup, finish, doctorMain) run on other
// code paths, and a probe reached from two different entry points is fine.
function runDoctorBody() {
  const src = read("doctor.mjs");
  const start = src.indexOf("export async function runDoctor");
  const end = src.indexOf("\nfunction doctorGroup", start);
  assert.ok(start > 0 && end > start, "could not locate the runDoctor body");
  return src.slice(start, end);
}

describe("doctor probe call graph", () => {
  it("invokes each probe function exactly once per run", () => {
    const direct = invocations(runDoctorBody());
    assert.ok(direct.length >= 5, `expected runDoctor to invoke probes, got ${direct.length}`);

    // One hop out: a shim that calls another shim's probe (perf-ensure calls
    // pushPerfChecks) makes that probe run too, so it counts as an invocation.
    const reachable = [...direct];
    for (const module of new Set(direct.map((k) => k.split(":")[0]))) {
      reachable.push(...invocations(read(module)));
    }

    const seen = new Map();
    for (const key of reachable) seen.set(key, (seen.get(key) || 0) + 1);
    const repeated = [...seen].filter(([, n]) => n > 1).map(([k, n]) => `${k} x${n}`);
    assert.deepEqual(
      repeated,
      [],
      `probes reachable more than once per doctor run: ${repeated.join(", ")}`
    );
  });

  it("leaves the ops bundle as the only owner of its probes", () => {
    const bundle = new Set(invocations(read("doctor-ops-bundle.mjs")));
    assert.ok(bundle.size >= 8, `expected the ops bundle to own probes, got ${bundle.size}`);
    const alsoInline = invocations(runDoctorBody()).filter((k) => bundle.has(k));
    assert.deepEqual(alsoInline, [], `runDoctor re-invokes bundle probes: ${alsoInline.join(", ")}`);
  });

  // The land-* manifests used to guarantee these stayed wired by grepping
  // doctor.mjs for each probe name. Those wires moved into the bundle, so the
  // guarantee is asserted here directly instead of through a patch needle.
  it("keeps the probes the land manifests used to guard", () => {
    const bundle = new Set(invocations(read("doctor-ops-bundle.mjs")));
    for (const fn of [
      "doctor-auth-refresh.mjs:pushAuthRefreshChecks",
      "doctor-receipt-metrics.mjs:pushReceiptMetricsChecks",
      "doctor-stop-route.mjs:pushStopRouteChecks",
      "doctor-smoke-compare.mjs:pushSmokeCompareChecks",
    ]) {
      assert.ok(bundle.has(fn), `ops bundle no longer invokes ${fn}`);
    }
    // And the bundle itself has to still be reachable from runDoctor.
    assert.ok(
      invocations(runDoctorBody()).includes("doctor-ops-bundle.mjs:pushDoctorOpsBundle"),
      "runDoctor no longer invokes the ops bundle"
    );
  });
});
