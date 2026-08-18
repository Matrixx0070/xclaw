/**
 * Cross-peer: telegram chat A cannot resolve paths into chat B workspace.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import {
  assertIsolatedPath,
  validateWorkspaceMap,
  resolvePeerWorkspace,
} from "../src/security/workspace-isolation.mjs";
import { resolveSandboxPath, getSandboxPolicy } from "../src/security/sandbox.mjs";

describe("workspace isolation cross-peer", () => {
  const rootA = path.resolve("/tmp/xclaw-peer-a");
  const rootB = path.resolve("/tmp/xclaw-peer-b");
  const cfg = {
    channels: {
      telegram: {
        workspaceByChatId: {
          chatA: rootA,
          chatB: rootB,
        },
      },
    },
  };

  it("peer workspaces are distinct", () => {
    const a = resolvePeerWorkspace(cfg, "telegram", "chatA");
    const b = resolvePeerWorkspace(cfg, "telegram", "chatB");
    assert.equal(path.resolve(a), rootA);
    assert.equal(path.resolve(b), rootB);
    assert.notEqual(a, b);
    const v = validateWorkspaceMap(cfg, "telegram");
    assert.equal(v.ok, true);
  });

  it("sandbox under A rejects absolute path into B", () => {
    const policy = getSandboxPolicy({ sandbox: { enabled: true } }, rootA);
    assert.throws(
      () => resolveSandboxPath(policy, path.join(rootB, "secret.txt")),
      /escapes workspace/
    );
  });

  it("assertIsolatedPath flags containment into other peer", () => {
    const ok = assertIsolatedPath(cfg, "telegram", "chatA", "notes.txt", "chatB");
    assert.equal(ok.ok, true);
    if (ok.resolved) {
      assert.ok(ok.resolved.startsWith(rootA));
      assert.ok(!ok.resolved.startsWith(rootB + path.sep));
    }

    const escape = assertIsolatedPath(
      cfg,
      "telegram",
      "chatA",
      path.join("..", "xclaw-peer-b", "secret.txt"),
      "chatB"
    );
    assert.equal(escape.ok, true);
    assert.equal(escape.denied, true);
  });
});
