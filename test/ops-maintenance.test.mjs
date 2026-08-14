import assert from "node:assert/strict";
import { describe, it } from "node:test";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { runOpsMaintenance, rotateJsonlIfOversize } from "../src/ops/maintenance.mjs";

async function tmpDir() {
  return fs.mkdtemp(path.join(os.tmpdir(), "xclaw-maint-"));
}

function lines(n, tag) {
  return Array.from({ length: n }, (_, i) => JSON.stringify({ i, tag, pad: "x".repeat(80) })).join("\n") + "\n";
}

describe("ops maintenance", () => {
  it("rotateJsonlIfOversize: under cap untouched, absent reported", async () => {
    const dir = await tmpDir();
    const p = path.join(dir, "small.jsonl");
    await fs.writeFile(p, lines(3, "s"));
    const r = await rotateJsonlIfOversize(p, { maxBytes: 10_000 });
    assert.equal(r.rotated, false);
    assert.equal(r.reason, "under_cap");
    const missing = await rotateJsonlIfOversize(path.join(dir, "nope.jsonl"), {});
    assert.equal(missing.rotated, false);
    assert.equal(missing.reason, "absent");
    await fs.rm(dir, { recursive: true, force: true });
  });

  it("rotateJsonlIfOversize: oversized file splits line-aligned, head archived to .1", async () => {
    const dir = await tmpDir();
    const p = path.join(dir, "big.jsonl");
    await fs.writeFile(p, lines(100, "big")); // ~10KB
    const r = await rotateJsonlIfOversize(p, { maxBytes: 5_000, keepBytes: 2_000 });
    assert.equal(r.rotated, true);
    const tail = await fs.readFile(p, "utf8");
    const head = await fs.readFile(`${p}.1`, "utf8");
    // no partial lines on either side of the split
    for (const chunk of [tail, head]) {
      for (const ln of chunk.trim().split("\n")) JSON.parse(ln);
    }
    assert.ok(Buffer.byteLength(tail) <= 2_000 + 200, `tail too big: ${Buffer.byteLength(tail)}`);
    // head + tail reconstruct the original exactly
    assert.equal(head + tail, lines(100, "big"));
    // newest entries are the ones kept
    const lastKept = JSON.parse(tail.trim().split("\n").at(-1));
    assert.equal(lastKept.i, 99);
    await fs.rm(dir, { recursive: true, force: true });
  });

  it("runOpsMaintenance: compacts old ledger segments, keeps recent, rotates oversized targets", async () => {
    const dir = await tmpDir();
    const cfg = {
      paths: { configDir: dir },
      ledger: { dir: path.join(dir, "ledger"), retentionDays: 30 },
      tokens: { ledgerPath: path.join(dir, "cost-ledger.jsonl") },
      // pin cron/doctor logs into the temp dir — defaults resolve to the
      // REAL ~/.xclaw files and this test uses a tiny maxBytes
      cron: { logPath: path.join(dir, "cron-events.log") },
      doctor: { cron: { logPath: path.join(dir, "doctor-cron.log") } },
    };
    // today's segment + a fake ancient segment
    await fs.mkdir(path.join(dir, "ledger"), { recursive: true });
    const today = new Date().toISOString().slice(0, 10);
    await fs.writeFile(path.join(dir, "ledger", `${today}.jsonl`), '{"v":1,"kind":"tool"}\n');
    await fs.writeFile(path.join(dir, "ledger", "2020-01-01.jsonl"), '{"v":1}\n');
    // oversized cost ledger
    await fs.writeFile(cfg.tokens.ledgerPath, lines(100, "cost"));
    const r = await runOpsMaintenance({ ...cfg, ops: { maintenance: { maxBytes: 5_000, keepBytes: 2_000 } } });
    assert.equal(r.skipped, false);
    assert.deepEqual(r.ledger.removed, ["2020-01-01.jsonl"]);
    const segs = await fs.readdir(path.join(dir, "ledger"));
    assert.equal(segs.length, 1); // today's survives
    assert.ok(r.rotated.some((x) => x.path === cfg.tokens.ledgerPath));
    assert.equal(r.errors.length, 0);
    await fs.rm(dir, { recursive: true, force: true });
  });

  it("runOpsMaintenance: disabled → skipped, nothing touched", async () => {
    const dir = await tmpDir();
    const cfg = {
      paths: { configDir: dir },
      ledger: { dir: path.join(dir, "ledger") },
      tokens: { ledgerPath: path.join(dir, "cost-ledger.jsonl") },
      ops: { maintenance: { enabled: false, maxBytes: 100 } },
    };
    await fs.writeFile(cfg.tokens.ledgerPath, lines(50, "c"));
    const before = (await fs.stat(cfg.tokens.ledgerPath)).size;
    const r = await runOpsMaintenance(cfg);
    assert.equal(r.skipped, true);
    assert.equal((await fs.stat(cfg.tokens.ledgerPath)).size, before);
    await fs.rm(dir, { recursive: true, force: true });
  });
});
