import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  resolveAutonomyPolicy,
  buildAutonomyAppendix,
  looksLikeHandoff,
  countToolsUsed,
  shouldForceToolRetry,
} from "../src/agent/autonomy-policy.mjs";
import { normalizeAgentRequest } from "../src/agent/run-agent.mjs";

describe("A1 autonomy policy", () => {
  it("defaults toolFirst and handoffRetry on", () => {
    const p = resolveAutonomyPolicy({});
    assert.equal(p.toolFirst, true);
    assert.equal(p.handoffRetry, true);
    assert.equal(p.requireVerifyHint, true);
    assert.equal(p.maxHandoffs, 1);
  });

  it("cfg can disable toolFirst", () => {
    const p = resolveAutonomyPolicy({ autonomy: { agent: { toolFirst: false } } });
    assert.equal(p.toolFirst, false);
  });

  it("appendix includes tool-first rules when enabled", () => {
    const a = buildAutonomyAppendix(resolveAutonomyPolicy({}));
    assert.match(a, /Tool-first/i);
    assert.match(a, /Handoff budget/i);
  });

  it("looksLikeHandoff detects common defer patterns", () => {
    assert.equal(
      looksLikeHandoff("Please paste the API endpoint and auth format."),
      true
    );
    assert.equal(
      looksLikeHandoff("You need to manually open the dashboard and screenshot."),
      true
    );
    assert.equal(
      looksLikeHandoff("Wrote hello.txt and verified contents via read."),
      false
    );
  });

  it("shouldForceToolRetry only when zero tools + handoff", () => {
    const policy = resolveAutonomyPolicy({});
    assert.equal(
      shouldForceToolRetry({
        policy,
        toolTrace: [],
        finalText: "Please provide the endpoint URL.",
      }),
      true
    );
    assert.equal(
      shouldForceToolRetry({
        policy,
        toolTrace: [{ name: "web_search" }],
        finalText: "Please provide the endpoint URL.",
      }),
      false
    );
    assert.equal(
      shouldForceToolRetry({
        policy,
        toolTrace: [],
        finalText: "Done. Created the file.",
      }),
      false
    );
  });

  it("A0+A1: channel still does not fork policy", () => {
    const cfg = { autonomy: { agent: { toolFirst: true } } };
    for (const channel of ["cli", "telegram", "webchat"]) {
      const n = normalizeAgentRequest({ goal: "ship it", channel, cfg });
      assert.equal(n.userMessage, "ship it");
      assert.equal(resolveAutonomyPolicy(n.cfg).toolFirst, true);
    }
  });

  it("countToolsUsed", () => {
    assert.equal(countToolsUsed(undefined), 0);
    assert.equal(countToolsUsed([{ name: "x" }, { name: "y" }]), 2);
  });
});
