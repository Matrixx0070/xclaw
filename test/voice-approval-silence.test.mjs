/**
 * A voice session runs the same agent loop every other channel runs, so a tool
 * call on a voice turn can pend for a human exactly as it does on Telegram or
 * webchat. The socket, however, forwards ONE event shape:
 *
 *   if (e?.type === "tool" && (e.phase === "start" || e.phase === "end"))
 *
 * `security/approval_required` is not that shape, and neither is
 * `security/denied`. Both were dropped. Proven against the shipping predicate
 * lifted literally from voice-ws.mjs before any of this was written:
 *
 *   approval_required  forwarded to the voice client: false
 *   denied             forwarded to the voice client: false
 *   tool/start         forwarded to the voice client: true
 *
 * This is class 38 at its worst. On Telegram (v3.352.0) and webchat (v3.353.0)
 * the ask arrived and only the RISK TIER was missing. Here the ASK ITSELF never
 * arrives: `loop.mjs:1331` waits `security.approvalTimeoutMs ?? 120_000` for a
 * human who was never asked, so the caller — on the one surface where a person
 * is holding a live conversation and can hear the silence — gets two minutes of
 * nothing and then a blocked reply. A tool that is denied is silent in the same
 * way.
 *
 * Two things this deliberately does NOT do:
 *
 * 1. It does not speak the prompt. Interleaving speech with the turn's final
 *    reply is a barge-in/duplex decision, and nothing observed here says which
 *    way it should go. The proven defect is that the event never reaches the
 *    client at all; the fix carries a ready-made `text` so a client can announce
 *    it without re-deriving the wording.
 * 2. It does not tell the caller to "say approve". `src/voice/commands.mjs` has
 *    eight intents and none of them approve anything. Instructing an action that
 *    does not exist is the same mixed-accuracy failure that kept assessRisk's
 *    fabricated reasons off the Telegram prompt in v3.352.0.
 *
 * Dedup is NOT reinvented here. `approval_required` is emitted twice per pending
 * (the second carries `restate: true`), and `src/security/approval-events.mjs`
 * exists precisely because telegram and webchat each rediscovered that the hard
 * way. Voice is the fourth channel and uses the primitive. On a voice surface a
 * duplicate ask is worse than on a text one — it is spoken over the caller.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import { voiceClientEvent } from "../src/gateway/voice-events.mjs";

const SID = "s_1";
// The exact event src/agent/loop.mjs:1347 emits from authorize's onPending.
const ASK = {
  type: "security",
  phase: "approval_required",
  pendingId: "p_1",
  name: "file_write",
  args: { file_path: "/root/x" },
  riskTier: "critical",
  riskFactors: ["outside workspace"],
  riskReasons: ["writes outside workspace (home)"],
};
// The restate emitted by loop-stages.mjs:455 after authorize times out.
const RESTATE = { ...ASK, args: undefined, restate: true, timedOut: true };
// loop-stages.mjs:454 emits denied and approval_required from the SAME object
// literal, so a real denial always carries restate: true. A denial gated on
// isNewApprovalAsk would therefore be dropped — the fixture keeps that honest.
const DENIED = {
  type: "security",
  phase: "denied",
  name: "file_write",
  pendingId: "p_1",
  restate: true,
  reason: "denied",
  message: "Tool file_write blocked (denied).",
};

describe("a voice client must be told when the machine is waiting on it", () => {
  it("forwards the approval ask", () => {
    const out = voiceClientEvent(ASK, { sessionId: SID });
    assert.ok(out, "the ask was dropped — the caller waits 120s in silence");
    assert.equal(out.event, "approval_required");
    assert.equal(out.pendingId, "p_1");
    assert.equal(out.name, "file_write");
    assert.equal(out.sessionId, SID);
  });

  it("carries the risk tier, the part of the assessment that ships", () => {
    assert.equal(voiceClientEvent(ASK, { sessionId: SID }).riskTier, "critical");
  });

  it("carries a spoken line naming the tool and the tier", () => {
    const { text } = voiceClientEvent(ASK, { sessionId: SID });
    assert.match(text, /file_write/);
    assert.match(text, /critical/i);
  });

  it("never instructs an action the voice surface cannot perform", async () => {
    const { text } = voiceClientEvent(ASK, { sessionId: SID });
    assert.doesNotMatch(text, /say ["']?approve/i, "no approve intent exists in commands.mjs");
    const cmds = await fs.readFile(new URL("../src/voice/commands.mjs", import.meta.url), "utf8");
    assert.doesNotMatch(cmds, /kind:\s*"approve/, "an approve intent now exists — revisit the wording");
  });

  it("forwards a denial, which was silent in the same way", () => {
    const out = voiceClientEvent(DENIED, { sessionId: SID });
    assert.ok(out, "a denied tool told the caller nothing");
    assert.equal(out.event, "blocked");
    assert.equal(out.phase, "denied");
    assert.equal(out.name, "file_write");
    assert.match(out.text, /file_write/);
  });

  it("forwards every other guard that stops a tool, not just the approval one", () => {
    // Enumerated from the producers: loop.mjs 1435/1461/1486/1307 and
    // loop-stages.mjs 329. Each one ends the tool call, and each was as silent
    // on a voice call as the approval ask was.
    for (const [phase, want] of [
      ["sandbox_denied", /sandbox/i],
      ["egress_denied", /egress/i],
      ["receipt_required", /receipt/i],
      ["quota_hard_circuit", /quota/i],
      ["plan_revalidate_failed", /plan/i],
    ]) {
      const out = voiceClientEvent({ type: "security", phase, name: "xclaw_bash" }, { sessionId: SID });
      assert.ok(out, `${phase} told the caller nothing`);
      assert.equal(out.event, "blocked");
      assert.equal(out.phase, phase);
      assert.match(out.text, want, `${phase} does not say why`);
    }
  });

  it("never announces another run's approval ask to this caller", () => {
    // The SSE-shaped variant carries `event: "security"` and no `type`, and
    // isNewApprovalAsk accepts it. It belongs to a different stream; forwarding
    // it would attribute a stranger's pending to this session.
    const foreign = { event: "security", phase: "approval_required", pendingId: "p_other", name: "file_write" };
    assert.equal(voiceClientEvent(foreign, { sessionId: SID }), null);
  });

  it("does not announce the same pending twice", () => {
    assert.equal(voiceClientEvent(RESTATE, { sessionId: SID }), null);
  });

  it("still forwards tool start and end unchanged", () => {
    for (const phase of ["start", "end"]) {
      const out = voiceClientEvent({ type: "tool", phase, name: "xclaw_bash" }, { sessionId: SID });
      assert.deepEqual(out, { type: "event", event: "tool", phase, name: "xclaw_bash", sessionId: SID });
    }
  });

  it("stays silent for events no voice client renders", () => {
    for (const e of [
      { type: "tool", phase: "delta" },
      { type: "token", text: "hi" },
      { type: "security", phase: "allowed" },
      null,
      undefined,
    ]) {
      assert.equal(voiceClientEvent(e, { sessionId: SID }), null, JSON.stringify(e));
    }
  });

  it("renders an absent tier as absent, never as a fabricated safe", () => {
    const out = voiceClientEvent({ ...ASK, riskTier: null }, { sessionId: SID });
    assert.equal(out.riskTier, null);
    assert.doesNotMatch(out.text, /safe/i);
  });

  it("does not leak the tool arguments onto the wire", () => {
    // Voice clients announce; args can carry a file path or a whole command
    // line, and the pendingId is enough for any surface to fetch the detail.
    const out = voiceClientEvent(ASK, { sessionId: SID });
    assert.equal(out.args, undefined);
    assert.doesNotMatch(JSON.stringify(out), /\/root\/x/);
  });
});

describe("the voice socket is wired to the decision", () => {
  it("the turn's onEvent asks voiceClientEvent instead of filtering by hand", async () => {
    // The callback lives inside runVoiceTurn, reachable only by running a real
    // agent turn over a real socket — so this is a source pin, in two clauses:
    // the call, and a ban on the literal predicate any revert reintroduces.
    const src = await fs.readFile(new URL("../src/gateway/voice-ws.mjs", import.meta.url), "utf8");
    assert.match(src, /voiceClientEvent\(e,\s*\{\s*sessionId\s*\}\)/);
    assert.doesNotMatch(
      src,
      /e\?\.type === "tool" && \(e\.phase === "start"/,
      "the hand-written filter is back — it drops every approval ask"
    );
  });

  it("imports the shared restate primitive rather than growing a fourth dedup", async () => {
    const src = await fs.readFile(new URL("../src/gateway/voice-events.mjs", import.meta.url), "utf8");
    assert.match(src, /from "\.\.\/security\/approval-events\.mjs"/);
  });
});
