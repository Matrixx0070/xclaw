/**
 * The CLI dispatcher is one big `switch (cmd)`. JavaScript takes the FIRST
 * matching case and never warns about a second one, so a duplicate label does
 * not fail a build, fail a test, or print anything — it silently deletes the
 * later block from the program.
 *
 * That is exactly what had happened: a second `case "auth"` carried ~220 lines
 * implementing `auth connected`, `auth token` and `auth accounts` (plus the
 * connected-OAuth vault), and every one of them exited 1 on the real host while
 * their code sat in the file looking implemented. `case "merge"` was shadowed
 * the same way, taking the subagent-worktree merge with it.
 *
 * Two tests, because either alone is weak: the structural one catches the shape
 * for every command at once, and the subprocess ones prove the commands
 * actually reach a handler on a real argv rather than a handler merely existing.
 */
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, mkdtempSync } from "node:fs";
import { execFile } from "node:child_process";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import path from "node:path";
import os from "node:os";

const execFileP = promisify(execFile);
const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const CLI = path.join(REPO, "bin", "xclaw.mjs");

/**
 * Case labels of the top-level dispatcher, by indentation: its cases sit at one
 * level (4 spaces) and anything nested sits deeper. The count assertion below
 * keeps a reformat from turning this into a census that finds nothing and
 * grades itself passing.
 */
function topLevelCaseLabels() {
  const src = readFileSync(CLI, "utf8");
  const labels = [];
  for (const line of src.split("\n")) {
    const m = /^ {4}case "([^"]+)":/.exec(line);
    if (m) labels.push(m[1]);
  }
  return labels;
}

describe("CLI dispatcher", () => {
  test("no command is shadowed by a duplicate case label", () => {
    const labels = topLevelCaseLabels();
    assert.ok(labels.length > 60, `scanner found only ${labels.length} cases — it stopped matching`);
    const seen = new Set();
    const dupes = [];
    for (const l of labels) {
      if (seen.has(l)) dupes.push(l);
      seen.add(l);
    }
    assert.deepEqual(
      dupes,
      [],
      `these commands are dead — an earlier case with the same label runs instead: ${dupes.join(", ")}`
    );
  });
});

describe("CLI subcommands that a duplicate case had shadowed", () => {
  // Isolated HOME: getConfigDir() is homedir()-derived with no env override, so
  // this must not read or write the operator's real ~/.xclaw.
  const home = mkdtempSync(path.join(os.tmpdir(), "xclaw-cli-shadow-"));
  const run = (args) =>
    execFileP(process.execPath, [CLI, ...args], {
      env: { ...process.env, HOME: home, XDG_CONFIG_HOME: path.join(home, ".config") },
      timeout: 60_000,
    }).then(
      (r) => ({ code: 0, ...r }),
      (e) => ({ code: e.code ?? 1, stdout: e.stdout || "", stderr: e.stderr || "" })
    );

  for (const [args, expect] of [
    [["auth", "token"], /hasToken/],
    [["auth", "accounts", "list"], /accounts/],
    [["auth", "connected", "list"], /providers/],
  ]) {
    test(`xclaw ${args.join(" ")} reaches its handler`, async () => {
      const r = await run(args);
      assert.equal(r.code, 0, `exit ${r.code} — command never reached its handler: ${r.stderr.slice(0, 300)}`);
      assert.match(r.stdout, expect);
    });
  }

  test("the subagent worktree merge is reachable", async () => {
    // Its own name: `merge` belongs to the swarm merge-proposal CLI, which
    // takes proposal ids. Sharing one label is what made this unreachable.
    const r = await run(["merge-worktree"]);
    assert.equal(r.code, 1, "expected the usage exit from the worktree merge");
    assert.match(r.stderr, /merge-worktree <subagentId>/);
  });
});
