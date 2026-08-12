import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  resolveRoleMap,
  resolveRolePolicy,
  selectRole,
} from "../src/providers/role-router.mjs";

describe("role-router", () => {
  it("resolveRoleMap reads router.roles", () => {
    const map = resolveRoleMap({
      router: {
        roles: {
          draft: "openai/gpt-4o-mini",
          act: "xai/grok-4.5",
          verify: "anthropic/claude-sonnet-5",
        },
      },
    });
    assert.equal(map.draft, "openai/gpt-4o-mini");
    assert.equal(map.act, "xai/grok-4.5");
    assert.equal(map.verify, "anthropic/claude-sonnet-5");
  });

  it("selectRole prefers draft on first turn when policy set", () => {
    const cfg = {
      router: {
        roles: {
          draft: "openai/gpt-4o-mini",
          act: "xai/grok-4.5",
        },
        rolePolicy: { preferDraftFirst: true, draftMaxTurns: 1 },
      },
    };
    assert.equal(selectRole({ turn: 0 }, cfg), "draft");
    assert.equal(selectRole({ turn: 1, forceAct: true }, cfg), "act");
  });

  it("selectRole defaults to act", () => {
    const cfg = {
      router: { roles: { act: "xai/grok-4.5" } },
    };
    assert.equal(selectRole({ turn: 0 }, cfg), "act");
  });

  it("resolveRolePolicy defaults", () => {
    const p = resolveRolePolicy({});
    assert.equal(p.toolTurns, "act");
    assert.equal(p.lastTurnVerify, true);
  });
});
