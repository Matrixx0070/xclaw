/**
 * `assessRisk` picks a tool's impact family with four unanchored substring
 * regexes over the tool NAME. That is sound for xclaw's own 45 tools, whose
 * names it chose. It is not sound for the 62 tools that arrive from a third
 * party over MCP, whose names it does not control — and the loop wires those
 * in unconditionally.
 *
 * `impact: "read"` is the ONLY route to the `safe` tier, so a name that wins
 * READ by accident is auto-approved with no human and no record. Two live
 * Linear mutations do exactly that:
 *
 *   resolve_diff_thread  -> READ, because "thread" CONTAINS "read"
 *   save_status_update   -> READ via "status"; "save" is absent from WRITE_RE
 *
 * The same accident runs the other way, and louder. Linear names every
 * mutation `save_*` and every reader `get_*`; `get` is in no family regex at
 * all, so fifteen pure readers match nothing, hit the fail-closed default
 * `impact = "exec"`, and tier `risky`. The classifier tiers 15 reads above 2
 * mutations — it is not lenient, it is inverted.
 *
 * A read certificate for a name we did not choose has to be EARNED at the
 * leading verb, never by a substring sitting anywhere in the name. Anything
 * else keeps the fail-closed default, which is already correct.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { assessRisk, tierRank } from "../src/security/risk.mjs";

const at = (tool) => assessRisk({ tool, args: {}, workingDir: process.cwd(), cfg: {} });

// The live posture is `autoApproveMaxTier: "low"`, so anything at or below
// "low" reaches the model with no human in the loop.
const autoApproved = (tool) => tierRank(at(tool).tier) <= tierRank("low");

describe("a third-party mutation must never be certified read", () => {
  for (const tool of [
    "mcp__linear__save_status_update",
    "mcp__linear__resolve_diff_thread",
    "mcp__linear__save_issue",
    "mcp__linear__save_comment",
    "mcp__linear__merge_diff",
    "mcp__linear__submit_diff_review",
    "mcp__linear__unshare_issue",
  ]) {
    it(`does not auto-approve ${tool.split("__").pop()}`, () => {
      const r = at(tool);
      assert.notEqual(r.factors.impact, "read", `${tool} was classified a read`);
      assert.equal(autoApproved(tool), false, `${tool} tiered ${r.tier} — auto-approved`);
    });
  }

  it("does not let a read word inside another word certify anything", () => {
    // "thread" contains "read"; "spread" and "already" would too.
    assert.notEqual(at("mcp__acme__thread_purge").factors.impact, "read");
  });

  it("keeps an unrecognised third-party verb fail-closed", () => {
    // The whole point: a verb nobody has heard of gets the conservative
    // default, not a certificate.
    assert.equal(autoApproved("mcp__acme__yeet_everything"), false);
  });
});

describe("a third-party reader must not be tiered above a mutation", () => {
  for (const tool of [
    "mcp__linear__get_issue",
    "mcp__linear__get_document",
    "mcp__linear__get_attachment",
    "mcp__linear__get_workspace",
    "mcp__linear__get_diff_threads",
    "mcp__github__get_me",
    "mcp__linear__list_issues",
    "mcp__linear__search_documentation",
    "mcp__deepwiki__read_wiki_contents",
    "mcp__github__search_repositories",
  ]) {
    it(`reads ${tool.split("__").pop()}`, () => {
      assert.equal(at(tool).factors.impact, "read", `${tool} is a read`);
      assert.equal(at(tool).tier, "safe");
    });
  }
});

describe("the fix must not disturb what already classifies correctly", () => {
  it("leaves third-party create/delete where they were", () => {
    assert.equal(at("mcp__linear__delete_status_update").tier, "critical");
    assert.equal(at("mcp__linear__create_issue_label").tier, "critical");
  });

  it("leaves third-party egress where it was", () => {
    const r = at("mcp__linear__prepare_attachment_upload");
    assert.equal(r.factors.impact, "egress");
    assert.equal(r.tier, "risky");
  });

  it("leaves xclaw's own tools byte-identical", () => {
    // These names are ours; the leading-verb rule is for names that are not.
    // Several of xclaw's readers put the verb LAST (`x_keyword_search`,
    // `mitm_status`) and must keep classifying as reads.
    for (const t of [
      "glob", "grep", "search_images", "x_keyword_search", "x_user_search",
      "x_semantic_search", "search_connected_tools", "mitm_status", "fabric_status",
    ]) {
      assert.equal(at(t).factors.impact, "read", `${t} stopped being a read`);
    }
    assert.equal(at("xclaw_bash").factors.impact, "exec");
    assert.equal(at("file_write").factors.impact, "write");
    assert.equal(at("browser_tab").factors.impact, "egress");
  });
});
