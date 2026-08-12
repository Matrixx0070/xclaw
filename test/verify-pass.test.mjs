import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { runVerifyPass } from "../src/providers/verify-pass.mjs";

describe("verify-pass", () => {
  it("skips when disabled", async () => {
    const r = await runVerifyPass({
      cfg: { router: { rolePolicy: { lastTurnVerify: false } } },
      finalText: "hello",
      userMessage: "hi",
      provider: { verify: async () => ({ message: { content: "VERIFY_OK" } }) },
    });
    assert.equal(r.skipped, true);
  });

  it("parses VERIFY_OK", async () => {
    const r = await runVerifyPass({
      cfg: {},
      finalText: "answer",
      userMessage: "q",
      provider: {
        roles: { verify: "anthropic/claude-sonnet-5" },
        verify: async () => ({
          message: { content: "VERIFY_OK\nLooks good." },
        }),
      },
    });
    assert.equal(r.skipped, false);
    assert.equal(r.ok, true);
    assert.equal(r.revise, false);
  });

  it("parses VERIFY_REVISE and replace", async () => {
    const r = await runVerifyPass({
      cfg: { router: { rolePolicy: { verifyReplace: true } } },
      finalText: "bad",
      userMessage: "q",
      provider: {
        roles: { verify: "x" },
        verify: async () => ({
          message: { content: "VERIFY_REVISE\n\nfixed answer" },
        }),
      },
    });
    assert.equal(r.revise, true);
    assert.equal(r.replaced, true);
    assert.equal(r.finalText, "fixed answer");
  });
});
