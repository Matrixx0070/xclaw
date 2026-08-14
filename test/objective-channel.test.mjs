import { describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { processInbound, normalizeInbound } from "../src/channels/runtime.mjs";
import { loadObjective, listObjectives, saveObjective } from "../src/agent/objective-store.mjs";
import { STATE_FENCE } from "../src/agent/objective.mjs";

async function cfgTmp() {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "xclaw-objch-"));
  return { paths: { configDir: dir }, objectives: { progressEverySegments: 0 }, _dir: dir };
}

function block(state) {
  return "```" + STATE_FENCE + "\n" + JSON.stringify(state) + "\n```";
}

const inboundBase = { channel: "telegram", chatId: "42", userId: "42", isDm: true };

async function waitStatus(cfg, id, targets, ms = 5000) {
  const deadline = Date.now() + ms;
  while (Date.now() < deadline) {
    const o = await loadObjective(cfg, id);
    if (o && targets.includes(o.status)) return o;
    await new Promise((r) => setTimeout(r, 25));
  }
  throw new Error("objective did not reach " + targets.join("/"));
}

/** Detached starts create the store entry asynchronously — poll for it. */
async function waitForObjective(cfg, ms = 5000) {
  const deadline = Date.now() + ms;
  while (Date.now() < deadline) {
    const [o] = await listObjectives(cfg);
    if (o) return o;
    await new Promise((r) => setTimeout(r, 25));
  }
  throw new Error("objective never created");
}

describe("objective channel routing", () => {
  it("/objective <goal> starts a detached mission that runs segments to done", async () => {
    const cfg = await cfgTmp();
    const notes = [];
    // segment stub: mission prompts contain the state contract → return done
    const replyWithAgent = async ({ message }) => {
      assert.ok(message.includes(STATE_FENCE), "segment prompt carries the contract");
      return {
        text: block({ status: "done", criteria: [{ id: "c1", text: "t", done: true }] }),
        turns: 2,
        toolTrace: [{}, {}],
        stopReason: "natural",
      };
    };
    const out = await processInbound(normalizeInbound({ ...inboundBase, text: "/objective understand the demo repo" }), {
      cfg,
      replyWithAgent,
      notify: async (t, m) => notes.push({ t, kind: m?.kind }),
    });
    assert.equal(out.via, "objective");
    assert.match(out.reply, /Mission started/);
    const obj = await waitForObjective(cfg);
    const settled = await waitStatus(cfg, obj.id, ["done"]);
    assert.equal(settled.status, "done");
    assert.ok(notes.some((n) => n.kind === "done"));
    await fs.rm(cfg._dir, { recursive: true, force: true });
  });

  it("normal turn cut off by maxTurns AUTO-PROMOTES into a mission (the live failure, healed)", async () => {
    const cfg = await cfgTmp();
    const notes = [];
    const replyWithAgent = async ({ message }) => {
      if (message.includes(STATE_FENCE)) {
        // detached segments after promotion complete the mission
        return {
          text: block({ status: "done", criteria: [{ id: "c1", text: "t", done: true }] }),
          turns: 1,
          toolTrace: [{}],
          stopReason: "natural",
        };
      }
      // the original turn: 25 tool calls then the turn cap — pre-fix this is
      // where the agent asked "should I continue?"
      return {
        text: "Partial analysis so far…",
        turns: 15,
        toolTrace: Array.from({ length: 25 }, () => ({})),
        stopReason: "maxTurns",
      };
    };
    const out = await processInbound(
      normalizeInbound({ ...inboundBase, text: "Read, analyze, and fully understand the entire DEMO project." }),
      { cfg, replyWithAgent, notify: async (t, m) => notes.push({ t, kind: m?.kind }) }
    );
    assert.equal(out.via, "objective_promoted");
    assert.match(out.reply, /continuing autonomously/);
    const obj = await waitForObjective(cfg);
    assert.equal(obj.objective, "Read, analyze, and fully understand the entire DEMO project.");
    const settled = await waitStatus(cfg, obj.id, ["done"]);
    assert.equal(settled.status, "done");
    await fs.rm(cfg._dir, { recursive: true, force: true });
  });

  it("message during a running mission is NOT treated as a new task", async () => {
    const cfg = await cfgTmp();
    const obj = (await import("../src/agent/objective-store.mjs")).newObjective({
      objective: "x",
      channel: "telegram",
      chatId: "42",
    });
    await saveObjective(cfg, obj); // status running
    const out = await processInbound(normalizeInbound({ ...inboundBase, text: "hey how is it going" }), {
      cfg,
      replyWithAgent: async () => {
        throw new Error("must not run a parallel agent turn");
      },
      notify: async () => {},
    });
    assert.equal(out.via, "objective");
    assert.match(out.reply, /is running/);
    await fs.rm(cfg._dir, { recursive: true, force: true });
  });

  it("awaiting_human: the owner's next message is routed as the answer", async () => {
    const cfg = await cfgTmp();
    const store = await import("../src/agent/objective-store.mjs");
    const obj = store.newObjective({ objective: "x", channel: "telegram", chatId: "42" });
    obj.status = "awaiting_human";
    obj.humanQuestion = "staging or prod?";
    await saveObjective(cfg, obj);
    let sawAnswer = false;
    const replyWithAgent = async ({ message }) => {
      if (message.includes("staging")) sawAnswer = true;
      return { text: block({ status: "done" }), turns: 1, toolTrace: [], stopReason: "natural" };
    };
    const out = await processInbound(normalizeInbound({ ...inboundBase, text: "use staging" }), {
      cfg,
      replyWithAgent,
      notify: async () => {},
    });
    assert.equal(out.via, "objective");
    assert.match(out.reply, /Resuming/i);
    const settled = await waitStatus(cfg, obj.id, ["done"]);
    assert.equal(settled.status, "done");
    assert.ok(sawAnswer, "answer reached the resumed segment");
    await fs.rm(cfg._dir, { recursive: true, force: true });
  });

  it("/objective stop + status work; no notify → graceful degradation", async () => {
    const cfg = await cfgTmp();
    const store = await import("../src/agent/objective-store.mjs");
    const obj = store.newObjective({ objective: "long thing", channel: "telegram", chatId: "42" });
    await saveObjective(cfg, obj);
    const status = await processInbound(normalizeInbound({ ...inboundBase, text: "/objective status" }), {
      cfg,
      replyWithAgent: async () => ({ text: "x" }),
    });
    assert.match(status.reply, /long thing/);
    const stop = await processInbound(normalizeInbound({ ...inboundBase, text: "/objective stop" }), {
      cfg,
      replyWithAgent: async () => ({ text: "x" }),
    });
    assert.match(stop.reply, /Stop requested/);
    assert.equal((await loadObjective(cfg, obj.id)).stopRequested, true);
    await fs.rm(cfg._dir, { recursive: true, force: true });
  });
});
