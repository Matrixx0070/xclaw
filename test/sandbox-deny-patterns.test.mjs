/**
 * `getSandboxPolicy` returns three policy fields. `allowPaths` is enforced
 * (sandbox.mjs:37), `readOnly` is enforced (sandbox.mjs:53), and
 * `denyPatterns` — defaulted to `**\/.git/objects/**`, so the code states an
 * intention even when no operator configured one — was read by nothing. A
 * fresh literal grep for "denyPatterns" across src/, bin/, test/, docs/ and
 * the 17MB computer bundle returned exactly ONE hit: the line that computes
 * it. The only consumer of the policy, `guardToolPaths`, checks escape and
 * writability and returns ok.
 *
 * So a deny list is a promise the system never kept. An operator who writes
 * `sandbox: { denyPatterns: ["**\/.env", "**\/id_rsa"] }` gets silent full
 * access to exactly the files they enumerated, and the shipped default never
 * protected the git object store it names — a file tool can write into
 * `.git/objects` inside its own workspace and corrupt the repository.
 *
 * The deny is checked AFTER resolution, so an allowlisted root cannot carry a
 * denied path through: allow widens the boundary, deny cuts holes in whatever
 * the boundary ended up being.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import {
  getSandboxPolicy,
  guardToolPaths,
  matchesDenyPattern,
} from "../src/security/sandbox.mjs";

const ws = path.resolve("/tmp/xclaw-deny-ws");
const guard = (cfg, tool, args) => guardToolPaths(cfg, ws, tool, args);
const withPatterns = (denyPatterns) => ({ sandbox: { enabled: true, denyPatterns } });

describe("a configured sandbox deny list must actually deny", () => {
  it("blocks the shipped default: the git object store", () => {
    const r = guard({ sandbox: { enabled: true } }, "xclaw_file_write", {
      file_path: ".git/objects/ab/cdef",
    });
    assert.equal(r.ok, false, "a write into .git/objects was allowed");
  });

  it("blocks an operator-configured pattern at the workspace root", () => {
    const r = guard(withPatterns(["**/.env"]), "xclaw_file_read", { path: ".env" });
    assert.equal(r.ok, false, "a denied .env was readable");
  });

  it("blocks the same pattern at any depth", () => {
    const r = guard(withPatterns(["**/.env"]), "xclaw_file_read", { path: "a/b/.env" });
    assert.equal(r.ok, false, "a nested denied .env was readable");
  });

  it("denies reads, not only writes — exfiltration is the point of a deny list", () => {
    const r = guard(withPatterns(["**/id_rsa"]), "xclaw_file_read", { path: "keys/id_rsa" });
    assert.equal(r.ok, false, "a denied private key was readable");
  });

  it("names the pattern that denied, so an operator can tell which rule fired", () => {
    const r = guard(withPatterns(["**/secrets/**"]), "xclaw_file_read", {
      path: "secrets/token.txt",
    });
    assert.equal(r.ok, false);
    assert.match(r.error, /secrets/, `deny message did not name the rule: ${r.error}`);
  });

  it("an allowlisted root outside the workspace cannot carry a denied path through", () => {
    const cfg = { sandbox: { enabled: true, allowPaths: ["/tmp/allowed"], denyPatterns: ["**/.env"] } };
    const ok = guardToolPaths(cfg, ws, "xclaw_file_read", { path: "/tmp/allowed/notes.md" });
    assert.equal(ok.ok, true, "allowPaths stopped working");
    const bad = guardToolPaths(cfg, ws, "xclaw_file_read", { path: "/tmp/allowed/.env" });
    assert.equal(bad.ok, false, "a deny pattern was bypassed by putting the file in an allowPath");
  });

  it("matches a workspace-relative pattern spelled without a leading globstar", () => {
    const r = guard(withPatterns([".git/objects/**"]), "xclaw_file_write", {
      file_path: ".git/objects/ab/cdef",
    });
    assert.equal(r.ok, false, "a relative-spelled deny pattern did not match");
  });

  it("treats a trailing /** as covering the directory itself", () => {
    const r = guard(withPatterns(["secrets/**"]), "xclaw_file_read", { path: "secrets" });
    assert.equal(r.ok, false, "the denied directory itself was reachable");
  });

  it("keeps a single star from crossing a path separator", () => {
    const cfg = withPatterns(["*.env"]);
    assert.equal(guard(cfg, "xclaw_file_read", { path: "prod.env" }).ok, false);
    assert.equal(
      guard(cfg, "xclaw_file_read", { path: "a/prod.env" }).ok,
      true,
      "a single star matched across a separator — the glob is too greedy"
    );
  });

  it("still allows everything the patterns do not name", () => {
    const cfg = withPatterns(["**/.env", "**/.git/objects/**"]);
    for (const p of ["notes.md", "src/index.mjs", ".gitignore", ".git/HEAD"]) {
      assert.equal(guard(cfg, "xclaw_file_read", { path: p }).ok, true, `${p} was over-blocked`);
    }
  });

  it("an explicitly empty deny list is an opt-out, not a fallback to the default", () => {
    const r = guard(withPatterns([]), "xclaw_file_write", { file_path: ".git/objects/ab/cd" });
    assert.equal(r.ok, true, "denyPatterns: [] did not disable the default");
  });

  it("a disabled sandbox enforces nothing, deny list included", () => {
    const r = guardToolPaths(
      { sandbox: { enabled: false, denyPatterns: ["**/.env"] } },
      ws,
      "xclaw_file_read",
      { path: ".env" }
    );
    assert.equal(r.ok, true, "a disabled sandbox started denying");
  });

  it("still resolves and returns rewritten args on the allowed path", () => {
    const r = guard(withPatterns(["**/.env"]), "xclaw_file_read", { path: "notes.md" });
    assert.equal(r.ok, true);
    assert.equal(r.args.path, path.join(ws, "notes.md"));
  });

  it("still denies a workspace escape when no pattern matches", () => {
    const r = guard(withPatterns(["**/.env"]), "xclaw_file_read", { path: "../../etc/passwd" });
    assert.equal(r.ok, false, "the escape check regressed");
  });

  it("a globstar-plus-separator does not match inside a single name", () => {
    // `**/` must mean "any number of leading directories", not "any prefix" —
    // otherwise `**/.env` silently swallows `production.env`.
    const r = guard(withPatterns(["**/.env"]), "xclaw_file_read", { path: "production.env" });
    assert.equal(r.ok, true, "**/.env matched a file that merely ends in .env");
  });

  it("a bare globstar still crosses separators", () => {
    const r = guard(withPatterns(["**secret**"]), "xclaw_file_read", { path: "a/b/secret/c" });
    assert.equal(r.ok, false, "a bare ** stopped crossing separators");
  });

  it("a question mark matches exactly one character, not a separator", () => {
    const cfg = withPatterns(["key?.pem"]);
    assert.equal(guard(cfg, "xclaw_file_read", { path: "key1.pem" }).ok, false);
    assert.equal(
      guard(cfg, "xclaw_file_read", { path: "key.pem" }).ok,
      true,
      "? matched an empty string"
    );
    assert.equal(
      guard(cfg, "xclaw_file_read", { path: "key/.pem" }).ok,
      true,
      "? matched a path separator"
    );
  });

  it("treats regex metacharacters in a pattern as literal text", () => {
    const cfg = withPatterns(["**/a.env"]);
    assert.equal(guard(cfg, "xclaw_file_read", { path: "a.env" }).ok, false);
    assert.equal(
      guard(cfg, "xclaw_file_read", { path: "aXenv" }).ok,
      true,
      "the dot in a pattern was compiled as a regex wildcard"
    );
  });

  it("anchors the match at both ends", () => {
    const cfg = withPatterns(["**/.env"]);
    assert.equal(
      guard(cfg, "xclaw_file_read", { path: ".envrc" }).ok,
      true,
      "the pattern matched a longer name — the match is not anchored at the end"
    );
    assert.equal(
      guard(cfg, "xclaw_file_read", { path: "my.env.bak" }).ok,
      true,
      "the pattern matched inside a longer name"
    );
  });

  it("a workspace-relative pattern does not reach outside the workspace", () => {
    // The relative candidate is only offered when the path is genuinely under
    // the workspace; otherwise `secrets/**` would deny an allowlisted
    // /tmp/allowed/secrets that the operator scoped to their own workspace.
    const cfg = {
      sandbox: { enabled: true, allowPaths: ["/tmp/allowed"], denyPatterns: ["secrets/**"] },
    };
    assert.equal(guardToolPaths(cfg, ws, "xclaw_file_read", { path: "secrets/a" }).ok, false);
    assert.equal(
      guardToolPaths(cfg, ws, "xclaw_file_read", { path: "/tmp/allowed/secrets/a" }).ok,
      true,
      "a workspace-relative rule leaked onto an allowlisted root"
    );
  });

  it("reads a deny list written as a bare string as one pattern", () => {
    const r = guard(withPatterns("**/.env"), "xclaw_file_read", { path: ".env" });
    assert.equal(r.ok, false, "a string deny list was ignored entirely");
    assert.equal(
      guard(withPatterns("**/.env"), "xclaw_file_read", { path: "notes.md" }).ok,
      true,
      "a string deny list was iterated character by character"
    );
  });

  it("ignores a deny list of the wrong shape rather than throwing", () => {
    const r = guard(withPatterns(42), "xclaw_file_read", { path: "notes.md" });
    assert.equal(r.ok, true);
  });

  it("judges a path outside the workspace by its absolute form only", () => {
    // `../allowed/x` is not a stable name for that file — it changes the moment
    // the workspace moves — so a rule written about the workspace must not be
    // matched against it. Outside paths are judged absolutely or not at all.
    const policy = getSandboxPolicy(withPatterns(["../**"]), ws);
    assert.equal(
      matchesDenyPattern(policy, "/tmp/allowed/x"),
      null,
      "an outside path was matched against its unstable workspace-relative name"
    );
    assert.equal(
      matchesDenyPattern(getSandboxPolicy(withPatterns(["/tmp/allowed/**"]), ws), "/tmp/allowed/x"),
      "/tmp/allowed/**",
      "an absolute deny pattern stopped matching an outside path"
    );
  });

  it("keeps the policy's deny list observable to callers", () => {
    const p = getSandboxPolicy(withPatterns(["**/.env"]), ws);
    assert.deepEqual(p.denyPatterns, ["**/.env"]);
  });
});
