import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { compileToolFilter, filterToolDefs } from "../src/agent/tool-filter.mjs";

// Loop integration is hermetic (temp HOME/state, injected fake provider,
// ledger off) per the session-kill-loop lesson.
const tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), "xclaw-toolfilter-"));
const savedHome = process.env.HOME;
const savedState = process.env.XCLAW_STATE_DIR;

let runAgentLoop;

before(async () => {
  process.env.HOME = tmpHome;
  process.env.XCLAW_STATE_DIR = tmpHome;
  ({ runAgentLoop } = await import("../src/agent/loop.mjs"));
});

after(() => {
  process.env.HOME = savedHome;
  if (savedState === undefined) delete process.env.XCLAW_STATE_DIR;
  else process.env.XCLAW_STATE_DIR = savedState;
  fs.rmSync(tmpHome, { recursive: true, force: true });
});

describe("compileToolFilter", () => {
  it("returns null for absent/empty lists (no filtering)", () => {
    assert.equal(compileToolFilter(undefined), null);
    assert.equal(compileToolFilter(null), null);
    assert.equal(compileToolFilter([]), null);
    assert.equal(compileToolFilter(["", "  "]), null);
  });

  it("matches exact names and trailing-* globs only", () => {
    const f = compileToolFilter(["xclaw_bash", "xclaw_file_*"]);
    assert.equal(f.match("xclaw_bash"), true);
    assert.equal(f.match("xclaw_file_read"), true);
    assert.equal(f.match("xclaw_file_write"), true);
    assert.equal(f.match("xclaw_browser_tab"), false);
    assert.equal(f.match("mcp__linear__list_teams"), false);
    assert.equal(f.match("xclaw_bash_extra"), false, "exact is exact");
  });

  it("'*' matches everything", () => {
    const f = compileToolFilter(["*"]);
    assert.equal(f.match("anything_at_all"), true);
    assert.equal(f.allowsPrefix("mcp__"), true);
  });

  it("allowsPrefix says whether ANY name under a prefix could pass", () => {
    const code = compileToolFilter(["xclaw_bash", "xclaw_file_*"]);
    assert.equal(code.allowsPrefix("mcp__"), false, "no mcp name can ever match");
    assert.equal(code.allowsPrefix("xclaw_file_"), true);

    const withMcp = compileToolFilter(["xclaw_bash", "mcp__github__*"]);
    assert.equal(withMcp.allowsPrefix("mcp__"), true);

    const exactMcp = compileToolFilter(["mcp__linear__list_teams"]);
    assert.equal(exactMcp.allowsPrefix("mcp__"), true);
  });

  it("filterToolDefs drops excluded defs and is a no-op without a filter", () => {
    const defs = [
      { type: "function", function: { name: "xclaw_bash" } },
      { type: "function", function: { name: "xclaw_image_generate" } },
      { type: "function", function: { name: "mcp__linear__list_teams" } },
    ];
    const f = compileToolFilter(["xclaw_bash"]);
    assert.deepEqual(
      filterToolDefs(defs, f).map((t) => t.function.name),
      ["xclaw_bash"]
    );
    assert.equal(filterToolDefs(defs, null), defs);
  });
});

const CFG = {
  agent: { maxTurns: 3, persistTranscript: false, allowTools: ["xclaw_bash", "xclaw_file_*"] },
  tokens: { enabled: false, ledger: false },
  skills: { enabled: false },
  memory: { enabled: false },
  computer: { autoStart: false },
  security: { autoApprove: true },
  hooks: { log: false },
};

/** Fake provider: calls an excluded tool on turn 1, then finishes. */
function excludedToolProvider(toolName, finalReply = "done") {
  const calls = [];
  let n = 0;
  return {
    providerName: "fake",
    model: "fake-1",
    baseUrl: "http://127.0.0.1:1",
    calls,
    async chat({ messages, tools }) {
      calls.push({
        messages: messages.map((m) => ({ role: m.role, content: m.content })),
        toolNames: (tools || []).map((t) => t.function.name),
      });
      n += 1;
      if (n === 1) {
        return {
          message: {
            role: "assistant",
            content: "",
            tool_calls: [{ id: "t1", function: { name: toolName, arguments: "{}" } }],
          },
          finishReason: "tool_calls",
        };
      }
      return { message: { role: "assistant", content: finalReply }, finishReason: "stop" };
    },
  };
}

describe("cfg.agent.allowTools in runAgentLoop", () => {
  it("advertised tools are filtered AND excluded dispatch is blocked", async () => {
    const provider = excludedToolProvider("host_capabilities");
    const out = await runAgentLoop({ userMessage: "go", cfg: CFG, provider });
    assert.equal(out.finalText ?? out.text, "done");

    // advertise side: nothing outside the allowlist reached the model
    const advertised = provider.calls[0].toolNames;
    assert.ok(advertised.length > 0, "some tools advertised");
    for (const name of advertised) {
      assert.ok(
        name === "xclaw_bash" || name.startsWith("xclaw_file_"),
        `unexpected advertised tool: ${name}`
      );
    }

    // dispatch side: the hallucinated excluded tool got a blocked message
    const toolMsg = provider.calls[1].messages.find((m) => m.role === "tool");
    assert.match(String(toolMsg.content), /not available in this run \(allowTools\)/);
  });

  it("no allowTools → unfiltered advertise (regression guard)", async () => {
    const provider = excludedToolProvider("host_capabilities");
    const cfg = { ...CFG, agent: { ...CFG.agent, allowTools: undefined } };
    const out = await runAgentLoop({ userMessage: "go", cfg, provider });
    assert.equal(out.finalText ?? out.text, "done");
    const advertised = provider.calls[0].toolNames;
    assert.ok(
      advertised.includes("host_capabilities"),
      "local tools advertised when no filter set"
    );
    const toolMsg = provider.calls[1].messages.find((m) => m.role === "tool");
    assert.ok(
      !/not available in this run/.test(String(toolMsg.content)),
      "tool executed rather than blocked"
    );
  });
});

describe("tool_use/tool_result pairing invariant", () => {
  it("a mid-turn stop (pending approval) backfills skipped calls' tool messages", async () => {
    // the shared approval gate is a process-wide singleton — earlier tests
    // primed it with autoApprove:true; rebuild it with THIS test's policy
    const { resetSharedApprovalGate } = await import("../src/security/approvals.mjs");
    resetSharedApprovalGate({ security: { autoApprove: false, approvalTimeoutMs: 250, approvalSlaMs: 250 } });
    // turn 1: bash (needs approval, will pend then time out → stop)
    // + file_read in a later batch (would be skipped → orphan tool_use pre-fix)
    let n = 0;
    const seqs = [];
    const events = [];
    const provider = {
      providerName: "fake", model: "fake-1", baseUrl: "http://127.0.0.1:1",
      async chat({ messages }) {
        seqs.push(messages.map((m) => ({ role: m.role, id: m.tool_call_id || null })));
        n += 1;
        if (n === 1) {
          return {
            message: {
              role: "assistant", content: "",
              tool_calls: [
                { id: "c_bash", function: { name: "xclaw_bash", arguments: JSON.stringify({ command: "echo hi" }) } },
                { id: "c_read", function: { name: "xclaw_file_read", arguments: JSON.stringify({ file_path: "package.json" }) } },
              ],
            },
            finishReason: "tool_calls",
          };
        }
        return { message: { role: "assistant", content: "done" }, finishReason: "stop" };
      },
    };
    const cfg = {
      agent: { maxTurns: 3, persistTranscript: false },
      tokens: { enabled: false, ledger: false },
      skills: { enabled: false },
      memory: { enabled: false },
      computer: { autoStart: false },
      security: { autoApprove: false, approvalTimeoutMs: 250, approvalSlaMs: 250 },
      hooks: { log: false },
    };
    const out = await runAgentLoop({
      userMessage: "go", cfg, provider,
      onEvent: (e) => events.push(e),
    });
    void out;
    // backfill fired for the skipped read call
    const skipped = events.find((e) => e.type === "tool" && e.phase === "skipped");
    assert.ok(skipped, "skipped backfill event emitted");
    assert.equal(skipped.callId, "c_read");
    // request 2 (the run CONTINUES after a pending stop — the exact path
    // that used to 400): both tool_use ids must have tool messages
    assert.ok(seqs.length >= 2, "run continued to a second request");
    const req2 = seqs[1];
    const aIdx = req2.findIndex((m) => m.role === "assistant");
    const toolIds = req2.filter((m) => m.role === "tool").map((m) => m.id);
    assert.ok(aIdx >= 0);
    assert.ok(toolIds.includes("c_bash"), "approval message paired");
    assert.ok(toolIds.includes("c_read"), "skipped call backfilled — no orphan tool_use");
  });
});
