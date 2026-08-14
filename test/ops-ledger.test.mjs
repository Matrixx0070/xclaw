import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "path";
import os from "os";
import {
  createLedger,
  queryLedger,
  whoTouched,
  ledgerStats,
  compactLedger,
  slimToolTraceEntry,
  ledgerDir,
} from "../src/ops/ledger.mjs";

function tmpCfg(dir) {
  return { ledger: { dir: path.join(dir, "ledger") } };
}

async function flush() {
  // appends are fire-and-forget; give the microtask queue a beat
  await new Promise((r) => setTimeout(r, 50));
}

describe("ops ledger", () => {
  let dir;
  before(async () => {
    dir = await fs.mkdtemp(path.join(os.tmpdir(), "xclaw-ledger-"));
  });
  after(async () => {
    await fs.rm(dir, { recursive: true, force: true });
  });

  it("appends and queries with id joins", async () => {
    const cfg = tmpCfg(dir);
    const ledger = createLedger(cfg, { ids: { sessionId: "s1" } });
    ledger.append({
      kind: "tool",
      data: { name: "xclaw_bash", family: "shell", status: "ok" },
    });
    ledger.append({
      kind: "tool",
      ids: { missionId: "msn_1" },
      data: {
        name: "file_write",
        family: "write",
        status: "ok",
        artifacts: [{ type: "file", ref: "src/app.mjs" }],
      },
    });
    ledger.append({
      kind: "policy",
      actor: "operator",
      data: { tool: "xclaw_bash", decision: "deny", mode: "human" },
    });
    await flush();

    const all = await queryLedger(cfg, { since: "1h" });
    assert.equal(all.events.length, 3);
    assert.equal(all.malformed, 0);

    const bySession = await queryLedger(cfg, { sessionId: "s1" });
    assert.equal(bySession.events.length, 3);

    const byMission = await queryLedger(cfg, { missionId: "msn_1" });
    assert.equal(byMission.events.length, 1);
    assert.equal(byMission.events[0].data.name, "file_write");

    const policies = await queryLedger(cfg, { kind: "policy" });
    assert.equal(policies.events.length, 1);
    assert.equal(policies.events[0].actor, "operator");
  });

  it("blocked/denied tool entries are recorded (the black-box case)", async () => {
    const cfg = tmpCfg(dir);
    const ledger = createLedger(cfg, { ids: { sessionId: "s2" } });
    ledger.append({
      kind: "tool",
      data: {
        name: "xclaw_bash",
        family: "shell",
        status: "blocked",
        policy: { phase: "approval", decision: "deny", reason: "denied" },
      },
    });
    await flush();
    const out = await queryLedger(cfg, { sessionId: "s2", kind: "tool" });
    assert.equal(out.events.length, 1);
    assert.equal(out.events[0].data.policy.decision, "deny");
  });

  it("who-touched joins tool artifacts and merge file lists", async () => {
    const cfg = tmpCfg(dir);
    const ledger = createLedger(cfg);
    ledger.append({
      kind: "tool",
      ids: { missionId: "msn_2", sessionId: "s3" },
      data: {
        name: "file_write",
        family: "write",
        status: "ok",
        artifacts: [{ type: "file", ref: "lib/target.mjs" }],
      },
    });
    ledger.append({
      kind: "merge",
      ids: { missionId: "msn_2" },
      data: { files: ["lib/target.mjs"], commit: "abc123" },
    });
    ledger.append({
      kind: "tool",
      ids: { sessionId: "s3" },
      data: {
        name: "file_read",
        family: "read",
        status: "ok",
        artifacts: [{ type: "file", ref: "lib/target.mjs" }],
      },
    });
    await flush();
    const hits = await whoTouched(cfg, "lib/target.mjs");
    // read-family artifact hit must NOT count as touching
    assert.equal(hits.length, 2);
    assert.equal(hits[0].ids.missionId, "msn_2");
    assert.equal(hits[1].via, "merge");
    assert.equal(hits[1].commit, "abc123");
  });

  it("survives malformed lines", async () => {
    const cfg = tmpCfg(dir);
    const seg = path.join(
      ledgerDir(cfg),
      `${new Date().toISOString().slice(0, 10)}.jsonl`
    );
    await fs.appendFile(seg, "{not json}\n", "utf8");
    const out = await queryLedger(cfg, { since: "1h" });
    assert.ok(out.malformed >= 1);
    assert.ok(out.events.length > 0);
  });

  it("slims tool trace entries (no result text, no raw args)", () => {
    const slim = slimToolTraceEntry({
      id: "t1",
      toolCallId: "c1",
      name: "xclaw_bash",
      nameNormalized: "shell",
      turn: 2,
      durationMs: 12,
      args: { command: "secret-content-here" },
      argsSummary: "echo hi",
      status: "ok",
      outcome: { exitCode: 0 },
      artifacts: [],
      result: { text: "full output", originalChars: 4200 },
    });
    assert.equal(slim.args, undefined);
    assert.equal(slim.resultChars, 4200);
    assert.equal(slim.argsSummary, "echo hi");
    assert.ok(!JSON.stringify(slim).includes("secret-content-here"));
    assert.ok(!JSON.stringify(slim).includes("full output"));
  });

  it("compacts old segments and reports stats", async () => {
    const cfg = tmpCfg(dir);
    const old = path.join(ledgerDir(cfg), "2020-01-01.jsonl");
    await fs.writeFile(old, "{}\n", "utf8");
    const stats1 = await ledgerStats(cfg);
    assert.ok(stats1.segments >= 2);
    const { removed } = await compactLedger(cfg, { keepDays: 30 });
    assert.ok(removed.includes("2020-01-01.jsonl"));
    const stats2 = await ledgerStats(cfg);
    assert.equal(stats2.segments, stats1.segments - 1);
  });

  it("sampling caps ok-reads only, never policy/failure", async () => {
    const cfg = { ledger: { dir: path.join(dir, "ledger-sampled"), maxPerMin: 2 } };
    const ledger = createLedger(cfg);
    for (let i = 0; i < 5; i++) {
      ledger.append({
        kind: "tool",
        data: { name: "file_read", family: "read", status: "ok" },
      });
    }
    for (let i = 0; i < 5; i++) {
      ledger.append({
        kind: "tool",
        data: {
          name: "file_read",
          family: "read",
          status: "blocked",
          policy: { phase: "hook", decision: "deny" },
        },
      });
    }
    await flush();
    const out = await queryLedger(cfg, { since: "1h" });
    const oks = out.events.filter((e) => e.data.status === "ok");
    const blocked = out.events.filter((e) => e.data.status === "blocked");
    assert.equal(oks.length, 2);
    assert.equal(blocked.length, 5);
  });

  it("disabled ledger writes nothing", async () => {
    const cfg = { ledger: { enabled: false, dir: path.join(dir, "ledger-off") } };
    const ledger = createLedger(cfg);
    ledger.append({ kind: "tool", data: { name: "x" } });
    await flush();
    const out = await queryLedger(cfg, {});
    assert.equal(out.events.length, 0);
  });
});
