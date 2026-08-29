/**
 * The A2 risk system exists to compute HOW DANGEROUS a tool call is. It runs
 * on every authorize, produces a tier, stores that tier on the pending record
 * (`entry.risk`), returns it from `listPending()`, and emits it on the
 * `approval_required` event as `riskTier`. The TUI renders it and even gates a
 * one-key Allow on `riskTier !== "critical"`.
 *
 * The operator's actual approval channel is Telegram, and the prompt it sends
 * is `formatPendingApprovalText` — tool, id, args, "Tap Allow or Deny." No
 * tier. A `file_write` outside the workspace (critical) and a Linear read
 * (safe) produced BYTE-IDENTICAL prompts apart from the tool name.
 *
 * It is dropped twice over, which is why reading either layer alone makes it
 * look present: the event carries `riskTier`, and the Telegram handler rebuilds
 * the item as `{id, tool, args}` — narrower than what it was handed, the same
 * capability-dropped-in-transit shape as the queue allow-list — and the
 * formatter has no slot for a tier even when one arrives.
 *
 * Approval fatigue is the mechanism: an unlabelled prompt asked 52 times in
 * half an hour is an Allow-everything prompt. The severity has to be ON the
 * prompt for the tap to mean anything.
 *
 * Reasons are deliberately NOT rendered. They are filesystem-shaped
 * ("writes outside workspace (home)") and are fabricated for third-party MCP
 * tools that touch no file — mixed-accuracy text in a security prompt is worse
 * than none. The tier is correct; ship only the tier.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  formatPendingApprovalText,
  approvalItemFromEvent,
} from "../src/channels/telegram/inline.mjs";
import { assessRisk } from "../src/security/risk.mjs";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const evt = (name, args = {}) => ({
  type: "security",
  phase: "approval_required",
  pendingId: "apr_1",
  name,
  args,
  riskTier: assessRisk({ tool: name, args, workingDir: process.cwd(), cfg: {} }).tier,
  riskReasons: ["because"],
});

describe("the approval prompt must carry the tier it was asked about", () => {
  it("names the tier for a critical action", () => {
    const txt = formatPendingApprovalText({
      id: "apr_1",
      tool: "file_write",
      args: { file_path: "/root/x.txt" },
      risk: { tier: "critical" },
    });
    assert.match(txt, /critical/i, `no tier in the prompt:\n${txt}`);
  });

  it("does not render a critical action identically to a safe one", () => {
    const one = (tier) => formatPendingApprovalText({ id: "a", tool: "t", args: {}, risk: { tier } });
    assert.notEqual(one("critical"), one("safe"), "critical and safe prompts are identical");
    assert.notEqual(one("critical"), one("risky"), "critical and risky prompts are identical");
  });

  it("reads the flat event shape as well as the pending record", () => {
    // Two producers (listPending -> item.risk, onPending -> e.riskTier). A
    // reader that understands only one of them silently blanks the other.
    const fromRecord = formatPendingApprovalText({ id: "a", tool: "t", args: {}, risk: { tier: "critical" } });
    const fromEvent = formatPendingApprovalText({ id: "a", tool: "t", args: {}, riskTier: "critical" });
    assert.match(fromEvent, /critical/i, `flat riskTier was ignored:\n${fromEvent}`);
    assert.equal(fromEvent, fromRecord, "the two shapes must render the same prompt");
  });

  it("stays sendable when no risk was assessed", () => {
    const txt = formatPendingApprovalText({ id: "a", tool: "t", args: {} });
    assert.match(txt, /Tap Allow or Deny/);
    assert.doesNotMatch(txt, /critical|risky|safe/i, "claimed a tier that was never computed");
  });

  it("still carries tool, id and args", () => {
    const txt = formatPendingApprovalText({
      id: "apr_9",
      tool: "xclaw_bash",
      args: { command: "ls" },
      risk: { tier: "risky" },
    });
    assert.match(txt, /xclaw_bash/);
    assert.match(txt, /apr_9/);
    assert.match(txt, /ls/);
  });

  it("does not paste the filesystem-shaped reasons into the prompt", () => {
    const txt = formatPendingApprovalText({
      id: "a",
      tool: "mcp__linear__create_issue",
      args: {},
      riskTier: "critical",
      riskReasons: ["writes outside workspace (home)"],
    });
    assert.doesNotMatch(txt, /outside workspace/, "a fabricated filesystem reason reached the operator");
  });
});

describe("the tier must survive the hop from event to prompt", () => {
  it("carries the tier out of the approval_required event", () => {
    const item = approvalItemFromEvent(evt("file_write", { file_path: "/root/x.txt" }));
    assert.equal(item.riskTier, "critical", "the event's tier was dropped in transit");
    assert.equal(item.id, "apr_1");
    assert.equal(item.tool, "file_write");
    assert.deepEqual(item.args, { file_path: "/root/x.txt" });
  });

  it("produces a prompt that names the tier end to end", () => {
    const txt = formatPendingApprovalText(approvalItemFromEvent(evt("file_write", { file_path: "/root/x.txt" })));
    assert.match(txt, /critical/i, `end-to-end prompt lost the tier:\n${txt}`);
  });

  it("keeps a lower tier distinguishable end to end", () => {
    const safe = formatPendingApprovalText(approvalItemFromEvent(evt("mcp__linear__get_issue")));
    const crit = formatPendingApprovalText(approvalItemFromEvent(evt("file_write", { file_path: "/root/x.txt" })));
    assert.notEqual(safe, crit);
  });

  it("does not invent a tier when the event carries none", () => {
    const item = approvalItemFromEvent({ pendingId: "a", name: "t", args: {} });
    assert.equal(item.riskTier, null);
  });
});

describe("the call site must use the carrier, not rebuild the item by hand", () => {
  // The handler lives inside handleUpdate's onEvent callback, reachable only by
  // running a real agent loop, so this is a source pin. The dedup sweep proved
  // a loose regex pin still matches a fail-opened mutant — so pin the exact
  // call AND ban the hand-built literal that any revert must reintroduce.
  const src = fs.readFileSync(
    path.join(path.dirname(fileURLToPath(import.meta.url)), "../src/channels/telegram/index.mjs"),
    "utf8"
  );

  it("routes the approval event through approvalItemFromEvent", () => {
    assert.match(src, /notifyOwnerApproval\(approvalItemFromEvent\(e\)\)/);
  });

  it("does not hand-narrow the event anywhere", () => {
    assert.doesNotMatch(src, /id:\s*e\.pendingId/, "the event is being rebuilt by hand — the tier is dropped again");
  });

  it("imports the carrier it calls", () => {
    assert.match(src, /approvalItemFromEvent,?\s*\n?\s*\}?\s*from "\.\/inline\.mjs"|approvalItemFromEvent,/);
  });
});
