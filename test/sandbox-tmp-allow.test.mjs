import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { getSandboxPolicy, resolveSandboxPath } from "../src/security/sandbox.mjs";

describe("sandbox allowPaths /tmp", () => {
  it("allows absolute /tmp file when allowPaths includes /tmp", () => {
    const policy = getSandboxPolicy(
      { sandbox: { enabled: true, allowPaths: ["/tmp"] } },
      "/tmp/xclaw-sub-abc"
    );
    const abs = resolveSandboxPath(policy, "/tmp/xclaw-swarm-proof.txt");
    assert.equal(abs, "/tmp/xclaw-swarm-proof.txt");
  });

  it("denies /tmp without allowPaths", () => {
    const policy = getSandboxPolicy(
      { sandbox: { enabled: true, allowPaths: [] } },
      "/tmp/xclaw-sub-abc"
    );
    assert.throws(() => resolveSandboxPath(policy, "/tmp/xclaw-swarm-proof.txt"));
  });
});
