import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { buildRoutedApprovalDigest } from "../src/security/approval-digest-route.mjs";

describe("sendApprovalDigest routing contract", () => {
  it("critical text never goes to soft targets", () => {
    const sent = [];
    const digest = {
      pending: 2,
      items: [
        { id: "c", tool: "rm", risk: { tier: "critical" } },
        { id: "s", tool: "ls", risk: { tier: "low" } },
      ],
    };
    const cfg = {
      security: {
        digestTargets: [{ channel: "telegram" }],
        digestCriticalTargets: [{ channel: "pager" }],
      },
    };
    const routed = buildRoutedApprovalDigest(digest, cfg);
    for (const t of routed.critical.targets) sent.push({ ch: t.channel, text: routed.critical.text });
    for (const t of routed.soft.targets) sent.push({ ch: t.channel, text: routed.soft.text });
    const pager = sent.find((s) => s.ch === "pager");
    const tg = sent.find((s) => s.ch === "telegram");
    assert.ok(pager.text.includes("CRITICAL"));
    assert.equal(routed.soft.items[0].id, "s");
    assert.ok(tg);
  });
});
