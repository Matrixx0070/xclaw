/**
 * The fabric lock is the only thing serialising read-modify-write on
 * tab-leases.json, commit-gates.json, session-roles.json and the automations
 * store — across processes. It creates its lockfile with open(path,"wx") and
 * writes the owner payload afterwards, so between those two awaits the file
 * exists and is EMPTY. A concurrent acquirer that reads it in that window
 * parsed "" as pid 0, decided the owner was dead, unlinked a LIVE lock and
 * took it — and the loser's release() then deleted the winner's lockfile,
 * because release unlinks the path unconditionally rather than the lock it
 * owns. Mutual exclusion was off for the whole overlap.
 *
 * Observed, not theorised: the full suite failed
 *   ["b-start","a-start","b-end","a-end"]
 * on browser-a8-fabric's serialisation test.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { acquireFabricLock, withFabricLock } from "../src/browser/fabric-lock.mjs";

const tmpRoot = async () => fs.mkdtemp(path.join(os.tmpdir(), "xclaw-flock-"));

describe("the fabric lock holds while its owner is still writing it", () => {
  it("does not reclaim a lockfile that has no payload yet", async () => {
    const root = await tmpRoot();
    await fs.writeFile(path.join(root, "fabric.lock"), "");
    await assert.rejects(
      () => acquireFabricLock({ root, timeoutMs: 250 }),
      /timeout/,
      "an empty lockfile is a lock mid-creation, not an abandoned one",
    );
  });

  it("does not reclaim a lockfile it cannot parse", async () => {
    const root = await tmpRoot();
    await fs.writeFile(path.join(root, "fabric.lock"), "{not json");
    await assert.rejects(() => acquireFabricLock({ root, timeoutMs: 250 }), /timeout/);
  });

  it("still reclaims an unparseable lockfile once it is stale", async () => {
    const root = await tmpRoot();
    const lp = path.join(root, "fabric.lock");
    await fs.writeFile(lp, "");
    const old = new Date(Date.now() - 60_000);
    await fs.utimes(lp, old, old);
    const release = await acquireFabricLock({ root, timeoutMs: 500, staleMs: 1_000 });
    assert.match(await fs.readFile(lp, "utf8"), /"pid":/);
    await release();
  });

  it("still reclaims a lock whose owner process is gone", async () => {
    const root = await tmpRoot();
    const lp = path.join(root, "fabric.lock");
    await fs.writeFile(lp, JSON.stringify({ pid: 0x7ffffffe, at: Date.now(), host: os.hostname() }));
    const release = await acquireFabricLock({ root, timeoutMs: 1_000 });
    assert.equal(JSON.parse(await fs.readFile(lp, "utf8")).pid, process.pid);
    await release();
  });

  it("publishes the lockfile by atomic link, never by create-then-write", async () => {
    // The empty window is a property of *how* the file appears, and a window
    // one await wide is not something a test can reliably stand inside — so
    // pin the mechanism. link() is atomic and what it publishes already
    // carries the payload; open(lp,"wx") publishes an empty file first.
    const src = await fs.readFile(new URL("../src/browser/fabric-lock.mjs", import.meta.url), "utf8");
    assert.match(src, /await fs\.link\(tmp, lp\)/);
    assert.doesNotMatch(src, /fs\.open\(lp, "wx"\)/);
  });

  it("never lets two holders overlap, however the writes interleave", async () => {
    const root = await tmpRoot();
    let held = 0;
    let overlaps = 0;
    const body = async (ms) => {
      held += 1;
      if (held > 1) overlaps += 1;
      await new Promise((r) => setTimeout(r, ms));
      held -= 1;
    };
    await Promise.all(
      Array.from({ length: 12 }, (_, i) => withFabricLock(() => body(i % 3), { root })),
    );
    assert.equal(overlaps, 0);
  });
});

describe("releasing a fabric lock releases only that lock", () => {
  it("leaves a lockfile that another owner has since taken", async () => {
    const root = await tmpRoot();
    const lp = path.join(root, "fabric.lock");
    const release = await acquireFabricLock({ root, timeoutMs: 500 });
    const theirs = JSON.stringify({ pid: process.pid, at: Date.now(), host: "elsewhere" });
    await fs.writeFile(lp, theirs);
    await release();
    assert.equal(
      await fs.readFile(lp, "utf8"),
      theirs,
      "release unlinked a lock belonging to someone else",
    );
    await fs.unlink(lp);
  });

  it("removes its own lockfile", async () => {
    const root = await tmpRoot();
    const lp = path.join(root, "fabric.lock");
    const release = await acquireFabricLock({ root, timeoutMs: 500 });
    await release();
    await assert.rejects(() => fs.readFile(lp, "utf8"), /ENOENT/);
  });
});
