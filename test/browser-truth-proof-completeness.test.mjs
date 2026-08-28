/**
 * A truth proof bundle must say when it is a sample.
 *
 * exportProofBundle emitted `bindings: bindings.slice(0, 50)` with no count and
 * no truncation marker beside it, while `flowCount` and `ruleCount` sat right
 * there in the same object — so a reader had a count for two of the three
 * evidence arrays and, for the third, no way to tell 50-of-50 from 50-of-2351.
 *
 * Measured on the live host at 3.314.0: 2351 rows in action-bindings.jsonl,
 * 1214 bundles in ~/.xclaw/mitm/proofs, and 1212 of them carrying exactly 50
 * bindings — the cap, hit on essentially every real export. The bundle is
 * sha256-attested (`contentSha256`), which makes silent clipping worse, not
 * better: it is tamper-evident but was not completeness-evident.
 */
import { describe, it, afterEach } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { exportProofBundle } from "../src/browser/truth.mjs";

const dirs = [];
afterEach(async () => {
  while (dirs.length) await fs.rm(dirs.pop(), { recursive: true, force: true });
  delete process.env.XCLAW_MITM_CONFDIR;
});

/** A mitm confdir holding n action bindings and the given flows. */
async function withConfdir({ bindings = 0, flows = [] } = {}) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "xclaw-proofc-"));
  dirs.push(dir);
  if (bindings) {
    const lines = [];
    for (let i = 0; i < bindings; i += 1) {
      lines.push(JSON.stringify({ actionId: `act_${i}`, ts: 1000 + i, flows: [] }));
    }
    await fs.writeFile(path.join(dir, "action-bindings.jsonl"), lines.join("\n") + "\n");
  }
  if (flows.length) {
    await fs.writeFile(
      path.join(dir, "flows.jsonl"),
      flows.map((f) => JSON.stringify(f)).join("\n") + "\n"
    );
  }
  process.env.XCLAW_MITM_CONFDIR = dir;
  return dir;
}

/** Export into a throwaway dest and read the bundle back off disk. */
async function bundleOf(opts = {}) {
  const dest = path.join(dirs[dirs.length - 1], "out", "proof.json");
  const r = await exportProofBundle({ ...opts, dest });
  assert.equal(r.ok, true);
  return JSON.parse(await fs.readFile(dest, "utf8"));
}

describe("truth proof bundle completeness", () => {
  it("THE REGRESSION: a clipped bindings array says it was clipped", async () => {
    await withConfdir({ bindings: 60 });
    const b = await bundleOf();
    assert.equal(b.bindings.length, 50);
    assert.equal(b.bindingCount, 50);
    assert.equal(b.truncated.bindings, true);
  });

  it("a complete bindings array is not marked truncated", async () => {
    await withConfdir({ bindings: 5 });
    const b = await bundleOf();
    assert.equal(b.bindings.length, 5);
    assert.equal(b.bindingCount, 5);
    assert.equal(b.truncated.bindings, false);
  });

  it("exactly at the cap with nothing behind it is complete, not truncated", async () => {
    // The boundary the naive "length === cap" heuristic gets wrong.
    await withConfdir({ bindings: 50 });
    const b = await bundleOf();
    assert.equal(b.bindingCount, 50);
    assert.equal(b.truncated.bindings, false);
  });

  it("every evidence array in the bundle carries a count", async () => {
    await withConfdir({ bindings: 3, flows: [{ ts: 1, method: "GET", host: "h", path: "/", status: 200 }] });
    const b = await bundleOf();
    for (const k of ["flowCount", "bindingCount"]) {
      assert.equal(typeof b[k], "number", `${k} missing from the bundle`);
    }
    assert.equal(b.policy.ruleCount, 0);
  });

  it("flows dropped by the limit are reported as truncated", async () => {
    const flows = [];
    for (let i = 0; i < 10; i += 1) {
      flows.push({ ts: 1000 + i, method: "GET", host: "h", path: `/${i}`, status: 200 });
    }
    await withConfdir({ flows });
    const b = await bundleOf({ limit: 4 });
    assert.equal(b.flowCount, 4);
    assert.equal(b.flows.length, 4);
    assert.equal(b.truncated.flows, true);
  });

  it("flows that all fit are not marked truncated", async () => {
    await withConfdir({ flows: [{ ts: 1, method: "GET", host: "h", path: "/", status: 200 }] });
    const b = await bundleOf({ limit: 200 });
    assert.equal(b.flowCount, 1);
    assert.equal(b.truncated.flows, false);
  });
});

describe("mitm_export tool output", () => {
  it("THE REGRESSION: the operator-facing text names the truncation", async () => {
    const dir = await withConfdir({ bindings: 60 });
    const { createMitmExportTool } = await import("../src/tools/browser-tools.mjs");
    const tool = createMitmExportTool({ cfg: null });
    const r = await tool.execute({ dest: path.join(dir, "out", "tool.json") });
    const text = typeof r === "string" ? r : r.content?.[0]?.text || r.text || "";
    assert.match(text, /bindings: 50 \(truncated\)/);
  });

  it("a complete export says so by saying nothing", async () => {
    const dir = await withConfdir({ bindings: 3 });
    const { createMitmExportTool } = await import("../src/tools/browser-tools.mjs");
    const tool = createMitmExportTool({ cfg: null });
    const r = await tool.execute({ dest: path.join(dir, "out", "tool2.json") });
    const text = typeof r === "string" ? r : r.content?.[0]?.text || r.text || "";
    assert.match(text, /bindings: 3$/m);
    assert.doesNotMatch(text, /truncated/);
  });
});
