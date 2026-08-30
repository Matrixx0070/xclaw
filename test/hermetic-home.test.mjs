// Pins the seam that keeps the test suite out of the operator's real home.
//
// 114 call sites under src/ build a path from os.homedir(). A test that forgets
// to pass a cfg or set XCLAW_STATE_DIR writes into the real ~/.xclaw, and
// v3.310.0 found three such leaks by measuring five files after the fact — a
// per-test-file discipline that the next careless test silently re-opens.
//
// The structural fix is a redirected HOME for the test process, so the
// assertion that matters is behavioural and is made from a CHILD process: what
// os.homedir() resolves to inside a process launched with hermeticEnv, and
// where a write built from it actually lands. Asserting on the env object alone
// would pass even if Node ignored HOME.

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import {
  createHermeticHome,
  hermeticEnv,
  listHomeWrites,
  removeHermeticHome,
} from "../scripts/hermetic-home.mjs";

/** Run a snippet in a child process under the given env, return trimmed stdout. */
function child(code, env) {
  return execFileSync(process.execPath, ["-e", code], {
    env,
    encoding: "utf8",
  }).trim();
}

describe("hermetic HOME", () => {
  it("creates distinct throwaway homes and removes them", () => {
    const a = createHermeticHome();
    const b = createHermeticHome();
    try {
      assert.notEqual(a, b);
      assert.ok(fs.existsSync(a) && fs.existsSync(b));
      assert.notEqual(path.resolve(a), path.resolve(os.homedir()));
    } finally {
      removeHermeticHome(a);
      removeHermeticHome(b);
    }
    assert.equal(fs.existsSync(a), false);
    assert.equal(fs.existsSync(b), false);
  });

  it("removal is a no-op without a home", () => {
    // The wrapper cleans up in a finally block that can run before creation.
    assert.doesNotThrow(() => removeHermeticHome(undefined));
  });

  it("leaves the caller's own environment untouched", () => {
    const home = createHermeticHome();
    const before = process.env.HOME;
    try {
      const env = hermeticEnv(process.env, home);
      assert.equal(env.HOME, home);
      assert.equal(process.env.HOME, before);
    } finally {
      removeHermeticHome(home);
    }
  });

  it("redirects os.homedir() in a child process", () => {
    const home = createHermeticHome();
    try {
      const seen = child(
        "process.stdout.write(require('os').homedir())",
        hermeticEnv(process.env, home)
      );
      assert.equal(seen, home);
    } finally {
      removeHermeticHome(home);
    }
  });

  it("contains a home-default write and reports it", () => {
    // The real invariant: src/ builds ~/.xclaw/<file> from os.homedir(), so a
    // write through that shape must land in the hermetic dir and nowhere else.
    const home = createHermeticHome();
    const real = path.join(os.homedir(), ".xclaw", "hermetic-probe.json");
    try {
      // A leftover probe from a prior leak (this host: 2026-08-28) must
      // not fail THIS run. The invariant is the child write below.
      try {
        fs.unlinkSync(real);
      } catch {
        /* absent */
      }
      child(
        [
          "const os=require('os'),fs=require('fs'),p=require('path');",
          "const f=p.join(os.homedir(),'.xclaw','hermetic-probe.json');",
          "fs.mkdirSync(p.dirname(f),{recursive:true});",
          "fs.writeFileSync(f,'{}');",
        ].join(""),
        hermeticEnv(process.env, home)
      );

      assert.ok(fs.existsSync(path.join(home, ".xclaw", "hermetic-probe.json")));
      assert.equal(
        fs.existsSync(real),
        false,
        "the write must not reach the real home"
      );
      assert.deepEqual(listHomeWrites(home), [".xclaw/hermetic-probe.json"]);
    } finally {
      removeHermeticHome(home);
    }
  });

  it("lists nested writes relative to the home, sorted", () => {
    const home = createHermeticHome();
    try {
      fs.mkdirSync(path.join(home, ".xclaw", "cron"), { recursive: true });
      fs.writeFileSync(path.join(home, ".xclaw", "cron", "jobs.sqlite"), "");
      fs.writeFileSync(path.join(home, ".xclaw", "a.json"), "");
      assert.deepEqual(listHomeWrites(home), [
        ".xclaw/a.json",
        ".xclaw/cron/jobs.sqlite",
      ]);
    } finally {
      removeHermeticHome(home);
    }
  });

  it("reports nothing for a run that wrote nothing", () => {
    const home = createHermeticHome();
    try {
      assert.deepEqual(listHomeWrites(home), []);
    } finally {
      removeHermeticHome(home);
    }
  });
});
