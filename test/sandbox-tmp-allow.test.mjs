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

// RULE(a) boundary — the allowPaths root matcher (sandbox.mjs:37-39) is
//   norm === root || norm.startsWith(root + path.sep)
// The `+ path.sep` is the sibling-prefix guard: a directory whose NAME merely
// shares an allow-root's string prefix (allow "/tmp/safe", path "/tmp/safe-evil")
// is NOT inside the allowed root and must be REFUSED as an escape. The existing
// "allows /tmp file" test admits a REAL subpath ("/tmp" + sep + name), which the
// mutated matcher `startsWith(root)` ALSO admits — so it never exercises this
// boundary. Dropping `+ path.sep` left the FULL suite green (3652/0), silently
// widening containment to any shared-prefix sibling of an allowlisted root: a
// `/data/safe` allowlist would leak writes into `/data/safe-secrets`. These pin
// the sibling REJECT (mutated → RED) with a real-subpath ADMIT (green both ways),
// the path-prefix analogue of RULE(a)'s hostname suffix-boundary discipline.
describe("sandbox allowPaths sibling-prefix boundary", () => {
  const policy = getSandboxPolicy(
    { sandbox: { enabled: true, allowPaths: ["/tmp/safe"] } },
    "/tmp/xclaw-sub-abc"
  );

  it("REFUSES a sibling dir that only shares an allow-root's name prefix", () => {
    // "/tmp/safe-evil" starts with the STRING "/tmp/safe" but is not under it.
    assert.throws(
      () => resolveSandboxPath(policy, "/tmp/safe-evil/leak.txt"),
      /escapes workspace/,
      "a shared-prefix sibling of an allowlisted root must be refused"
    );
  });

  it("allows a real subpath under the allowlisted root (boundary admit)", () => {
    assert.equal(resolveSandboxPath(policy, "/tmp/safe/ok.txt"), "/tmp/safe/ok.txt");
  });
});
