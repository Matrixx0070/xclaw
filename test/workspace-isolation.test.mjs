
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import {
  assertIsolatedPath,
  validateWorkspaceMap,
  resolvePeerWorkspace,
} from "../src/security/workspace-isolation.mjs";

describe("workspace isolation", () => {
  const cfg = {
    channels: {
      telegram: {
        workspaceByChatId: {
          "111": "/tmp/xclaw-ws-a",
          "222": "/tmp/xclaw-ws-b",
        },
      },
    },
  };

  it("distinct map ok", () => {
    const v = validateWorkspaceMap(cfg, "telegram");
    assert.equal(v.ok, true);
    assert.equal(v.count, 2);
  });

  it("shared map fails", () => {
    const v = validateWorkspaceMap({
      channels: { telegram: { workspaceByChatId: { a: "/tmp/x", b: "/tmp/x" } } },
    });
    assert.equal(v.ok, false);
  });

  it("cross-read into other workspace denied or not contained", () => {
    const r = assertIsolatedPath(cfg, "telegram", "111", "secret.txt", "222");
    assert.equal(r.ok, true);
    // resolved under A, not B
    if (r.resolved) {
      assert.ok(r.resolved.includes("xclaw-ws-a") || r.resolved.startsWith("/tmp/xclaw-ws-a"));
    }
  });

  it("escape denied", () => {
    const r = assertIsolatedPath(cfg, "telegram", "111", "../xclaw-ws-b/secret.txt", "222");
    assert.equal(r.ok, true);
    assert.equal(r.denied, true);
  });
});
