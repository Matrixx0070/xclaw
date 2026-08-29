import { test } from "node:test";
import assert from "node:assert/strict";
import { summarizeToolPack } from "../src/cli/doctor-tool-pack.mjs";

const AVAIL = ["xclaw_bash", "xclaw_file_read", "xclaw_file_write", "glob", "grep"];

test("no allowlist configured is reported as no filtering", () => {
  const r = summarizeToolPack({ patterns: null, availableNames: AVAIL });
  assert.equal(r.severity, "ok");
  assert.match(r.message, /no allowlist/i);
  const empty = summarizeToolPack({ patterns: [], availableNames: AVAIL });
  assert.equal(empty.severity, "ok");
  assert.match(empty.message, /no allowlist/i);
});

test("an allowlist whose every entry resolves is ok", () => {
  const r = summarizeToolPack({
    patterns: ["xclaw_bash", "glob"],
    availableNames: AVAIL,
  });
  assert.equal(r.severity, "ok");
  assert.match(r.message, /2 allowed/);
});

test("an entry naming a tool that does not exist is named in a warning", () => {
  const r = summarizeToolPack({
    patterns: ["xclaw_bash", "xclaw_file_list", "list_dir"],
    availableNames: AVAIL,
  });
  assert.equal(r.severity, "warn");
  assert.match(r.message, /xclaw_file_list/);
  assert.match(r.message, /list_dir/);
});

test("an alias of an available tool is not a gap", () => {
  // `bash` and `xclaw_bash` are one capability: reporting the short form as
  // missing would make the row cry wolf on every correctly-written pack.
  const r = summarizeToolPack({ patterns: ["bash", "file_read"], availableNames: AVAIL });
  assert.equal(r.severity, "ok");
});

test("computer server unreachable is unverified, never a missing-tool warning", () => {
  // Half the shipped packs name computer-plane tools. Grading them against a
  // list that could not include them would report every one as missing.
  const r = summarizeToolPack({
    patterns: ["xclaw_bash", "xclaw_file_list"],
    availableNames: ["glob"],
    computerReachable: false,
  });
  assert.equal(r.severity, "ok");
  assert.match(r.message, /unverified/i);
  assert.doesNotMatch(r.message, /xclaw_bash/);
});

test("an empty available list is a failed probe, not an empty toolbox", () => {
  const r = summarizeToolPack({ patterns: ["xclaw_bash"], availableNames: [] });
  assert.equal(r.severity, "ok");
  assert.match(r.message, /unverified/i);
});

test("glob patterns are not graded", () => {
  const r = summarizeToolPack({ patterns: ["mcp__*", "xclaw_bash"], availableNames: AVAIL });
  assert.equal(r.severity, "ok");
});

test("blank entries are not counted as allowed tools", () => {
  // allowTools is operator-written JSON; a trailing null or "" would otherwise
  // be reported in the count ("3 allowed") and, worse, graded as a missing
  // tool named "".
  const r = summarizeToolPack({ patterns: ["xclaw_bash", null, ""], availableNames: AVAIL });
  assert.equal(r.severity, "ok");
  assert.match(r.message, /1 allowed/);
});
