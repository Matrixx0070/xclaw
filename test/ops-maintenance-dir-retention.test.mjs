/**
 * The proof-bundle directory was bounded by nothing.
 *
 * exportProofBundle (src/browser/truth.mjs) writes proof_<ts>.json into
 * <mitm confdir>/proofs on every call. Nothing in the codebase ever reads a
 * bundle back, no doctor probe looks at the directory, and ops maintenance --
 * whose whole job is "unbounded append-only files" -- listed neither the
 * directory in its targets nor an exemption for it in its "Not handled here"
 * note. Measured live at 3.315.0: 1214 bundles, 9.7 MB, oldest 2026-08-13,
 * newest the same hour it was measured.
 *
 * Two properties are pinned here. The first is retention: age and count
 * ceilings that actually delete. The second is the one the module was missing
 * everywhere -- rotateJsonlIfOversize's under-cap result is computed and then
 * dropped by `if (r.rotated)`, so a file at 99% of its cap and a file that
 * does not exist produce identical (empty) output. A directory that is filling
 * up must be visible BEFORE it crosses a ceiling, so the census is returned
 * whether or not anything was pruned.
 */
import assert from "node:assert/strict";
import { describe, it, afterEach } from "node:test";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { pruneDirByAge, runOpsMaintenance } from "../src/ops/maintenance.mjs";

const DAY = 24 * 3600 * 1000;
const dirs = [];
afterEach(async () => {
  while (dirs.length) await fs.rm(dirs.pop(), { recursive: true, force: true });
});

async function tmpDir(tag) {
  const d = await fs.mkdtemp(path.join(os.tmpdir(), `xclaw-prune-${tag}-`));
  dirs.push(d);
  return d;
}

/** Write `name` with a real mtime `ageDays` in the past. */
async function aged(dir, name, ageDays, body = '{"proof":true}') {
  const p = path.join(dir, name);
  await fs.writeFile(p, body);
  const when = new Date(Date.now() - ageDays * DAY);
  await fs.utimes(p, when, when);
  return p;
}

async function names(dir) {
  return (await fs.readdir(dir)).sort();
}

describe("pruneDirByAge", () => {
  it("deletes entries past the age ceiling and keeps the rest", async () => {
    const d = await tmpDir("age");
    await aged(d, "proof_1.json", 40);
    await aged(d, "proof_2.json", 31);
    await aged(d, "proof_3.json", 2);
    const r = await pruneDirByAge(d, { maxAgeMs: 30 * DAY });
    assert.equal(r.pruned, 2);
    assert.deepEqual(await names(d), ["proof_3.json"]);
  });

  it("THE REGRESSION: reports the census even when it prunes nothing", async () => {
    // `if (r.rotated)` in runOpsMaintenance drops exactly this result, which is
    // why a directory at 1214 files looked identical to one that was empty.
    const d = await tmpDir("census");
    await aged(d, "proof_1.json", 1, "x".repeat(100));
    await aged(d, "proof_2.json", 1, "x".repeat(100));
    const r = await pruneDirByAge(d, { maxAgeMs: 30 * DAY });
    assert.equal(r.pruned, 0);
    assert.equal(r.files, 2, "a directory holding files must not report zero");
    assert.equal(r.bytes, 200);
    assert.equal(r.dir, d);
  });

  it("keepMax keeps the NEWEST entries, not an arbitrary slice", async () => {
    const d = await tmpDir("count");
    for (let i = 0; i < 10; i++) await aged(d, `proof_${i}.json`, 10 - i);
    const r = await pruneDirByAge(d, { maxAgeMs: 365 * DAY, keepMax: 4 });
    assert.equal(r.pruned, 6);
    // ages were 10,9,8..1 for i=0..9, so the newest four are i=6..9
    assert.deepEqual(await names(d), [
      "proof_6.json",
      "proof_7.json",
      "proof_8.json",
      "proof_9.json",
    ]);
  });

  it("prunes only what the name pattern matches, never directories", async () => {
    const d = await tmpDir("match");
    await aged(d, "proof_1.json", 90);
    await aged(d, "operator-notes.txt", 90);
    await fs.mkdir(path.join(d, "subdir"));
    const r = await pruneDirByAge(d, { maxAgeMs: 30 * DAY, match: /^proof_\d+\.json$/ });
    assert.equal(r.pruned, 1);
    assert.deepEqual(await names(d), ["operator-notes.txt", "subdir"]);
  });

  it("an absent directory is reported, not thrown", async () => {
    const d = await tmpDir("absent");
    const r = await pruneDirByAge(path.join(d, "nope"), { maxAgeMs: DAY });
    assert.equal(r.reason, "absent");
    assert.equal(r.pruned, 0);
    assert.equal(r.files, 0);
  });
});

describe("runOpsMaintenance covers the proof-bundle directory", () => {
  it("censuses the proofs dir and prunes past retention", async () => {
    const confdir = await tmpDir("confdir");
    const proofs = path.join(confdir, "proofs");
    await fs.mkdir(proofs);
    // real bundle names: exportProofBundle writes proof_<Date.now()>.json
    const old = `proof_${Date.now() - 45 * DAY}.json`;
    const fresh = `proof_${Date.now()}.json`;
    await aged(proofs, old, 45);
    await aged(proofs, fresh, 1);

    const prev = process.env.XCLAW_MITM_CONFDIR;
    process.env.XCLAW_MITM_CONFDIR = confdir;
    let r;
    try {
      // maintenance:{enabled:true} only; the JSONL half targets host-global
      // files, so give it a cap nothing on this host can exceed.
      r = await runOpsMaintenance({
        paths: { configDir: confdir },
        ledger: { dir: path.join(confdir, "ledger") },
        ops: { maintenance: { maxBytes: 2 ** 40 } },
      });
    } finally {
      if (prev === undefined) delete process.env.XCLAW_MITM_CONFDIR;
      else process.env.XCLAW_MITM_CONFDIR = prev;
    }

    const entry = (r.dirs || []).find((d) => d.dir === proofs);
    assert.ok(entry, `proofs dir missing from maintenance result: ${JSON.stringify(r.dirs)}`);
    assert.equal(entry.pruned, 1);
    assert.deepEqual(await names(proofs), [fresh]);
    // the surviving file is still counted -- census, not just a delete log
    assert.equal(entry.files, 2);
  });
});
