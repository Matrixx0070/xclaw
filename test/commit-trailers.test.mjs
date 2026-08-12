import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  buildXclawTrailers,
  appendCommitTrailers,
  DEFAULT_CO_AUTHORED_BY,
} from "../src/git/commit-trailers.mjs";

describe("commit trailers", () => {
  it("builds default XClaw trailers", () => {
    const t = buildXclawTrailers({});
    assert.match(t, /Generated with \[XClaw\]/);
    assert.match(t, /Co-Authored-By: XClaw <noreply@xclaw.local>/);
    assert.ok(t.includes(DEFAULT_CO_AUTHORED_BY));
  });

  it("allows custom co-authored line", () => {
    const t = buildXclawTrailers({
      git: {
        commitGeneratedWith: "Generated with [XClaw](noreply@xclaw.local)",
        commitCoAuthoredBy: "Co-Authored-By: XClaw <noreply@xclaw.local>",
      },
    });
    assert.match(t, /Generated with \[XClaw\]\(noreply@xclaw.local\)/);
  });

  it("appends after blank line", () => {
    const msg = appendCommitTrailers(
      "feat: foo",
      "Co-Authored-By: XClaw <noreply@xclaw.local>"
    );
    assert.equal(
      msg,
      "feat: foo\n\nCo-Authored-By: XClaw <noreply@xclaw.local>"
    );
  });

  it("is idempotent if trailer already present", () => {
    const once = appendCommitTrailers(
      "feat: foo\n\nCo-Authored-By: XClaw <noreply@xclaw.local>",
      "Co-Authored-By: XClaw <noreply@xclaw.local>"
    );
    assert.equal(once.match(/Co-Authored-By: XClaw/g)?.length, 1);
  });
});
