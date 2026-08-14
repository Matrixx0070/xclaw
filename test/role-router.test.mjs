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

import {
  resolveRoleEffort,
  resolveRoleToolPack,
  DEFAULT_ROLE_EFFORT,
  ROLE_TOOL_PACKS,
} from "../src/providers/role-router.mjs";

describe("role effort and tool packs", () => {
  it("DEFAULT_ROLE_EFFORT has act low and verify high", () => {
    assert.equal(DEFAULT_ROLE_EFFORT.act, "low");
    assert.equal(DEFAULT_ROLE_EFFORT.verify, "high");
  });

  it("resolveRoleEffort uses role defaults", () => {
    assert.equal(resolveRoleEffort("act", {}), "low");
    assert.equal(resolveRoleEffort("verify", {}), "high");
  });

  it("resolveRoleEffort honors roleEffort map", () => {
    assert.equal(
      resolveRoleEffort("act", { router: { roleEffort: { act: "medium" } } }),
      "medium"
    );
  });

  it("resolveRoleToolPack act returns core list", () => {
    const pack = resolveRoleToolPack({ agent: { toolPack: "act" } });
    assert.ok(Array.isArray(pack));
    assert.ok(pack.includes("xclaw_bash"));
    assert.ok(!pack.includes("web_search"));
  });

  it("resolveRoleToolPack browse includes search", () => {
    const pack = resolveRoleToolPack({ agent: { toolPack: "browse" } });
    assert.ok(pack.includes("web_search"));
  });

  it("explicit allowTools wins over toolPack", () => {
    const pack = resolveRoleToolPack({
      agent: { toolPack: "act", allowTools: ["web_search"] },
    });
    assert.deepEqual(pack, ["web_search"]);
  });

  it("full pack means no filter", () => {
    assert.equal(resolveRoleToolPack({ agent: { toolPack: "full" } }), null);
  });
});
