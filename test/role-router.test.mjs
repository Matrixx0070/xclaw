import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  resolveRoleMap,
  resolveRolePolicy,
  selectRole,
  ROLES,
} from "../src/providers/role-router.mjs";

describe("role router", () => {
  it("exports standard roles", () => {
    assert.ok(ROLES.includes("draft"));
    assert.ok(ROLES.includes("act"));
    assert.ok(ROLES.includes("verify"));
  });

  it("resolveRoleMap from cfg.router.roles", () => {
    const map = resolveRoleMap({
      router: {
        roles: {
          draft: "openai/gpt-4o-mini",
          act: "xai/grok-4.3",
          verify: "anthropic/claude-sonnet-5",
        },
      },
    });
    assert.equal(map.draft, "openai/gpt-4o-mini");
    assert.equal(map.act, "xai/grok-4.3");
    assert.equal(map.verify, "anthropic/claude-sonnet-5");
  });

  it("resolveRoleMap falls back to agent.model for act", () => {
    const map = resolveRoleMap({ agent: { model: "xai/grok-4.5" } });
    assert.equal(map.act, "xai/grok-4.5");
  });

  it("resolveRolePolicy defaults", () => {
    const p = resolveRolePolicy({});
    assert.equal(p.firstTurn, "act");
    assert.equal(p.toolTurns, "act");
    assert.equal(p.lastTurnVerify, true);
  });

  it("selectRole forceRole wins", () => {
    assert.equal(
      selectRole({ forceRole: "verify", turn: 0 }, {
        router: { roles: { verify: "anthropic/claude-sonnet-5", act: "xai/grok-4.3" } },
      }),
      "verify"
    );
  });

  it("selectRole uses act by default on turn 0", () => {
    const role = selectRole(
      { turn: 0 },
      { router: { roles: { act: "xai/grok-4.3", draft: "openai/gpt-4o-mini" } } }
    );
    assert.equal(role, "act");
  });

  it("selectRole preferDraftFirst on turn 0 when configured", () => {
    const role = selectRole(
      { turn: 0 },
      {
        router: {
          roles: { act: "xai/grok-4.3", draft: "openai/gpt-4o-mini" },
          rolePolicy: { preferDraftFirst: true, firstTurn: "draft" },
        },
      }
    );
    assert.equal(role, "draft");
  });
});
