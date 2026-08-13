import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";
import fs from "node:fs/promises";
import {
  createAutomation,
  executeAutomation,
  getAutomation,
  listResults,
} from "../src/automations/index.mjs";
import { withStoreLock, loadStore } from "../src/automations/store.mjs";

// Real incident (2026-08-13): a manual `automations run` raced the gateway's
// own scheduled tick for the SAME automation. The manual run's LLM call took
// long enough that the scheduled tick completed and saved its result in the
// meantime; the manual run then finished and saved its own stale
// pre-call snapshot of the whole store, silently erasing the scheduled
// tick's already-persisted result and state. The manual run's own result
// never appeared anywhere.

describe("automations store concurrency", () => {
  let cfg;
  let dir;

  before(async () => {
    dir = await fs.mkdtemp(path.join(os.tmpdir(), "xclaw-auto-conc-"));
    cfg = { paths: { automationsFile: path.join(dir, "automations.json") } };
  });
  after(async () => {
    await fs.rm(dir, { recursive: true, force: true }).catch(() => {});
  });

  it("a slow run does not clobber a fast concurrent write to a DIFFERENT automation", async () => {
    const a = createAutomation(cfg, {
      prompt: "slow one",
      everyMs: 3_600_000,
      enabled: false,
      name: "slow",
    });
    const b = createAutomation(cfg, {
      prompt: "fast one",
      everyMs: 3_600_000,
      enabled: false,
      name: "fast",
    });
    assert.equal(a.ok, true);
    assert.equal(b.ok, true);

    let releaseSlow;
    const slowGate = new Promise((r) => (releaseSlow = r));
    const slowRun = executeAutomation(cfg, a.automation.id, {
      runner: async () => {
        await slowGate; // held open until after the fast run below finishes
        return { ok: true, text: "slow result" };
      },
    });

    // Fast run against a DIFFERENT automation completes and saves while the
    // slow one is still in flight.
    const fastResult = await executeAutomation(cfg, b.automation.id, {
      runner: async () => ({ ok: true, text: "fast result" }),
    });
    assert.equal(fastResult.ok, true);

    releaseSlow();
    const slowResult = await slowRun;
    assert.equal(slowResult.ok, true);

    // Both automations' results must survive — neither writer erased the
    // other's write.
    const store = loadStore(cfg);
    assert.equal(store.automations.length, 2, "both automations still present");
    const fastAuto = store.automations.find((x) => x.id === b.automation.id);
    const slowAuto = store.automations.find((x) => x.id === a.automation.id);
    assert.equal(fastAuto.lastStatus, "ok");
    assert.equal(slowAuto.lastStatus, "ok");
    assert.equal(
      listResults(cfg, { automationId: b.automation.id }).length,
      1,
      "fast automation's result was not erased by the slow writer"
    );
    assert.equal(
      listResults(cfg, { automationId: a.automation.id }).length,
      1,
      "slow automation's own result was actually persisted"
    );
  });

  it("a concurrent executeAutomation for the SAME id is rejected, not double-run", async () => {
    const a = createAutomation(cfg, {
      prompt: "same-id race",
      everyMs: 3_600_000,
      enabled: false,
      name: "same-id",
    });
    let releaseFirst;
    const gate = new Promise((r) => (releaseFirst = r));
    let calls = 0;
    const runner = async () => {
      calls++;
      await gate;
      return { ok: true, text: "done" };
    };
    const first = executeAutomation(cfg, a.automation.id, { runner });
    // Give the first call's synchronous prefix a tick to register as running.
    await new Promise((r) => setImmediate(r));
    const second = await executeAutomation(cfg, a.automation.id, { runner });
    assert.equal(second.ok, false);
    assert.equal(second.error, "already_running");

    releaseFirst();
    const firstResult = await first;
    assert.equal(firstResult.ok, true);
    assert.equal(calls, 1, "runner was invoked exactly once, not twice");
  });

  it("withStoreLock always operates on a freshly-loaded store, not a caller's stale reference", async () => {
    const a = createAutomation(cfg, {
      prompt: "lock test",
      everyMs: 3_600_000,
      enabled: false,
      name: "lock-test",
    });
    // Simulate a concurrent external write between two lock acquisitions.
    await withStoreLock(cfg, (store) => {
      const auto = store.automations.find((x) => x.id === a.automation.id);
      auto.lastStatus = "external-write-1";
      return store;
    });
    await withStoreLock(cfg, (store) => {
      const auto = store.automations.find((x) => x.id === a.automation.id);
      assert.equal(
        auto.lastStatus,
        "external-write-1",
        "second lock acquisition sees the first one's write"
      );
      auto.lastStatus = "external-write-2";
      return store;
    });
    assert.equal(getAutomation(cfg, a.automation.id).lastStatus, "external-write-2");
  });
});
