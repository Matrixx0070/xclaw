import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "path";
import os from "os";
import { execFileSync } from "node:child_process";
import { openIntelStore, repoKey } from "../src/intel/intel-store.mjs";

function git(cwd, ...args) {
  execFileSync("git", args, { cwd, stdio: "ignore" });
}

describe("intel store (B1)", () => {
  let base;
  let repo;
  let cfg;
  before(async () => {
    base = await fs.mkdtemp(path.join(os.tmpdir(), "xclaw-intel-"));
    repo = path.join(base, "repo");
    await fs.mkdir(path.join(repo, "src"), { recursive: true });
    await fs.mkdir(path.join(repo, "test"), { recursive: true });
    await fs.writeFile(
      path.join(repo, "src/util.mjs"),
      "export function greetHelper(name) { return `hi ${name}`; }\n"
    );
    await fs.writeFile(
      path.join(repo, "src/app.mjs"),
      'import { greetHelper } from "./util.mjs";\nexport function runApp() { return greetHelper("x"); }\n'
    );
    await fs.writeFile(
      path.join(repo, "test/app.test.mjs"),
      'import { runApp } from "../src/app.mjs";\nrunApp();\n'
    );
    git(repo, "init", "-q");
    git(repo, "add", "-A");
    git(repo, "-c", "user.email=t@t", "-c", "user.name=t", "commit", "-qm", "init");
    cfg = { intel: { dir: path.join(base, "intel-store") } };
  });
  after(async () => {
    await fs.rm(base, { recursive: true, force: true });
  });

  it("cold build indexes symbols, imports, tests-map", async () => {
    const store = await openIntelStore(cfg, repo);
    const { idx, refresh } = await store.ensureFresh();
    assert.ok(refresh.cold);
    assert.ok(idx.files["src/util.mjs"].symbols.some((s) => s.name === "greetHelper"));
    assert.equal(idx.importedBy["src/util.mjs"], 1);
    assert.deepEqual(idx.testsMap["test/app.test.mjs"], ["src/app.mjs"]);
  });

  it("warm refresh re-extracts only changed files", async () => {
    const store = await openIntelStore(cfg, repo);
    await store.ensureFresh();
    const { refresh: warm } = await store.ensureFresh();
    assert.equal(warm.cold, false);
    assert.equal(warm.changed, 0);
    await fs.writeFile(
      path.join(repo, "src/util.mjs"),
      "export function greetHelper(n) { return n; }\nexport function newHelper() {}\n"
    );
    const { idx, refresh } = await store.ensureFresh();
    assert.equal(refresh.changed, 1);
    assert.ok(idx.files["src/util.mjs"].symbols.some((s) => s.name === "newHelper"));
  });

  it("a worktree shares the main repo's store (git-common-dir keying)", async () => {
    const wt = path.join(base, "wt");
    git(repo, "worktree", "add", "-q", wt, "-b", "test-wt");
    try {
      assert.equal(await repoKey(repo), await repoKey(wt));
    } finally {
      git(repo, "worktree", "remove", "--force", wt);
    }
  });

  it("query ranks the relevant file and includes brief facts", async () => {
    const store = await openIntelStore(cfg, repo);
    await store.addNote({
      kind: "mission_done",
      goal: "prior mission",
      verifyCommands: ["node test/app.test.mjs"],
      ok: true,
    });
    const out = await store.query("change the greetHelper greeting");
    assert.ok(out.files.some((f) => f.path === "src/util.mjs"));
    assert.ok(out.contextText.includes("Repo brief"));
    assert.ok(out.contextText.includes("node test/app.test.mjs"));
  });

  it("corrupt index rebuilds silently", async () => {
    const store = await openIntelStore(cfg, repo);
    await store.ensureFresh();
    await fs.writeFile(path.join(store.dir, "index.json"), "{corrupt", "utf8");
    const { refresh } = await store.ensureFresh();
    assert.ok(refresh.cold);
  });

  it("symbols lookup finds definitions", async () => {
    const store = await openIntelStore(cfg, repo);
    await store.ensureFresh();
    const hits = await store.symbols("greetHelper");
    assert.ok(hits.length >= 1);
    assert.equal(hits[0].path, "src/util.mjs");
  });
});
