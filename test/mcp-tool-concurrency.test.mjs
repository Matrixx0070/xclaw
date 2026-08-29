/**
 * `tool-concurrency.mjs` opens with an invariant: "Mutating / exec / browser
 * tools stay serial." It is enforced by a hand-maintained FORCE_SERIAL denylist
 * plus a fail-closed default — anything unrecognised is serial. That default is
 * correct, and then `getConcurrencyClass` re-opens it:
 *
 *   if (/_read$|^read_|list_|search|ocr|fetch|info|status|probe/.test(n))
 *     return "parallel-safe";
 *
 * Five of those alternatives are UNANCHORED substrings. `status` matches
 * anywhere in the name — so `delete_status_update` and `save_status_update` are
 * both certified parallel-safe. The two anchored alternatives (`_read$`,
 * `^read_`) show the author knew position mattered; the other five lost it.
 *
 * That would be a latent bug if the names were ours. They are not. MCP tools
 * join the loop as `mcp__<server>__<tool>` where BOTH segments come from a
 * third-party server, so the denylist can never enumerate them: it is a
 * denylist guarding an open namespace. Against the live config (deepwiki,
 * github, linear) discovery returns 62 tools, 23 of them classified parallel —
 * including a real delete and a real write, which `partitionToolCalls` then
 * places in ONE concurrent batch.
 *
 * The rule the classifier lost: a read-only intent is expressed by the leading
 * VERB, not by a word appearing anywhere in the name. `list_issues` reads;
 * `delete_status_update` does not, and the only thing they share is a substring.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { getConcurrencyClass, partitionByConcurrency } from "../src/tools/planes.mjs";
import { isParallelSafeTool, partitionToolCalls } from "../src/agent/tool-concurrency.mjs";

// Verbatim names discovered from the live MCP servers.
const MUTATING = [
  "mcp__linear__delete_status_update",
  "mcp__linear__save_status_update",
];
const READING = [
  "mcp__linear__get_issue_status",
  "mcp__linear__get_status_updates",
  "mcp__linear__list_issues",
  "mcp__linear__list_issue_statuses",
  "mcp__linear__list_release_pipelines",
  "mcp__linear__search_documentation",
  "mcp__github__search_repositories",
];

describe("a third-party tool name must not be read as parallel-safe by substring", () => {
  for (const name of MUTATING) {
    it(`keeps ${name} serial`, () => {
      assert.equal(getConcurrencyClass(name), "serial", `${name} was certified parallel-safe`);
      assert.equal(isParallelSafeTool(name), false, `${name} would run concurrently`);
    });
  }

  it("never puts a delete and a write in the same concurrent batch", () => {
    const calls = [
      { function: { name: "mcp__linear__save_status_update" } },
      { function: { name: "mcp__linear__delete_status_update" } },
    ];
    const batches = partitionToolCalls(calls);
    assert.ok(
      batches.every((b) => !b.parallel || b.calls.length === 1),
      "a mutating pair was dispatched concurrently"
    );
  });

  it("keeps mutating names out of the parallel half of partitionByConcurrency", () => {
    // The second partitioner reads getConcurrencyClass directly and never sees
    // FORCE_SERIAL, so the fix has to land in the classifier, not the caller.
    const { parallel } = partitionByConcurrency(MUTATING.map((name) => ({ name })));
    assert.deepEqual(parallel, [], "mutating tools reached the parallel half");
  });
});

describe("genuine read-only tools keep their concurrency", () => {
  for (const name of READING) {
    it(`still runs ${name} in parallel`, () => {
      assert.equal(isParallelSafeTool(name), true, `${name} lost its parallelism`);
    });
  }

  it("still parallelises the local read-only tools", () => {
    for (const n of [
      "fabric_status", "mitm_status", "ocr", "search_images",
      "web_fetch", "x_keyword_search", "x_thread_fetch", "x_user_search",
      "xclaw_file_read", "web_search", "search_connected_tools",
    ]) {
      assert.equal(isParallelSafeTool(n), true, `${n} lost its parallelism`);
    }
  });

  it("still forces the known mutators serial", () => {
    for (const n of ["xclaw_bash", "xclaw_file_write", "xclaw_computer_act", "browser_click"]) {
      assert.equal(isParallelSafeTool(n), false, `${n} became parallel`);
    }
  });
});

describe("a third-party name earns parallelism at the verb, not at the suffix", () => {
  it("keeps a trailing-noun mutator serial", () => {
    // The suffix rule that lets `fabric_status` run parallel is only safe on
    // names we own; `update_status` ends the same way and writes.
    for (const n of [
      "mcp__linear__update_status",
      "mcp__acme__overwrite_info",
      "mcp__acme__purge_search",
    ]) {
      assert.equal(isParallelSafeTool(n), false, `${n} was certified parallel-safe`);
    }
  });

  it("still parallelises our own trailing-noun readers", () => {
    for (const n of ["fabric_status", "mitm_status", "ocr", "web_fetch"]) {
      assert.equal(isParallelSafeTool(n), true, `${n} lost its parallelism`);
    }
  });
});

describe("the fix must not widen parallelism for local tools", () => {
  it("leaves the local media/video viewers serial", () => {
    // `view_x_video` shells out to ffmpeg and writes frames. Closing a fail-open
    // on third-party names is no reason to start running it concurrently, so
    // the read-verb list carries only verbs the MCP surface actually needs.
    assert.equal(isParallelSafeTool("view_image"), false);
    assert.equal(isParallelSafeTool("view_x_video"), false);
  });
});
