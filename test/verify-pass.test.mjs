
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  runVerifyPass,
  extractCompletionText,
} from "../src/providers/verify-pass.mjs";

describe("verify pass", () => {
  it("extractCompletionText handles string and parts", () => {
    assert.equal(extractCompletionText({ content: "hi" }), "hi");
    assert.equal(
      extractCompletionText({
        message: { content: [{ type: "text", text: "a" }, { type: "text", text: "b" }] },
      }),
      "a\nb"
    );
  });

  it("skips when lastTurnVerify false", async () => {
    const r = await runVerifyPass({
      finalText: "x",
      userMessage: "y",
      provider: { chat: async () => ({ content: "VERIFY_OK fine" }) },
      cfg: { router: { rolePolicy: { lastTurnVerify: false } } },
    });
    assert.equal(r.skipped, true);
    assert.equal(r.reason, "disabled");
  });

  it("VERIFY_OK marks ok", async () => {
    const r = await runVerifyPass({
      finalText: "answer",
      userMessage: "goal",
      provider: {
        roles: { verify: "xai/grok-4.3" },
        verify: async () => ({ content: "VERIFY_OK looks good" }),
      },
      cfg: {},
    });
    assert.equal(r.skipped, false);
    assert.equal(r.ok, true);
    assert.equal(r.replaced, false);
  });

  it("VERIFY_REVISE + verifyReplace replaces finalText", async () => {
    const r = await runVerifyPass({
      finalText: "bad",
      userMessage: "goal",
      provider: {
        roles: { verify: "xai/grok-4.3" },
        chat: async () => ({ content: "VERIFY_REVISE\nfixed answer" }),
      },
      cfg: { router: { rolePolicy: { verifyReplace: true } } },
    });
    assert.equal(r.revise, true);
    assert.equal(r.replaced, true);
    assert.equal(r.finalText, "fixed answer");
  });

  it("VERIFY_REVISE + verifyAppend appends section", async () => {
    const r = await runVerifyPass({
      finalText: "act answer",
      userMessage: "goal",
      provider: {
        roles: { verify: "xai/grok-4.3" },
        verify: async () => ({ content: "VERIFY_REVISE\nnote: path wrong" }),
      },
      cfg: { router: { rolePolicy: { verifyAppend: true } } },
    });
    assert.equal(r.appended, true);
    assert.ok(r.finalText.includes("act answer"));
    assert.ok(r.finalText.includes("VERIFY:"));
    assert.ok(r.finalText.includes("note: path wrong"));
  });
});
