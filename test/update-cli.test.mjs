/**
 * xclaw update: git vs npm detect, dirty skip, dry-run, no-restart,
 * eval-suite refuse, unpublished fail-clean. One copy.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";
import {
  parseUpdateArgs,
  detectInstallKind,
  evalSuiteInFlight,
  DEFAULT_TIMEOUT_MS,
  PACKAGE_NAME,
  updateHelpText,
  runUpdate,
} from "../src/cli/update.mjs";

const execFileP = promisify(execFile);
const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const CLI = path.join(REPO, "bin", "xclaw.mjs");
const SRC = fs.readFileSync(path.join(REPO, "src", "cli", "update.mjs"), "utf8");
const TEST_SRC = fs.readFileSync(fileURLToPath(import.meta.url), "utf8");

function tmpDir(prefix) {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

describe("xclaw update", () => {
  it("parses flags and defaults timeout to 600000", () => {
    const d = parseUpdateArgs([]);
    assert.equal(d.json, false);
    assert.equal(d.dryRun, false);
    assert.equal(d.noRestart, false);
    assert.equal(d.yes, false);
    assert.equal(d.timeoutMs, DEFAULT_TIMEOUT_MS);
    assert.equal(DEFAULT_TIMEOUT_MS, 600_000);
    const p = parseUpdateArgs(["--json", "--dry-run", "--no-restart", "--yes", "--timeout", "12000"]);
    assert.equal(p.json, true);
    assert.equal(p.dryRun, true);
    assert.equal(p.noRestart, true);
    assert.equal(p.yes, true);
    assert.equal(p.timeoutMs, 12000);
  });

  it("detects git when .git exists, else npm/pnpm/bun", () => {
    const git = tmpDir("xclaw-upd-git-");
    fs.mkdirSync(path.join(git, ".git"));
    const g = detectInstallKind(git);
    assert.equal(g.kind, "git");
    assert.equal(g.packageName, PACKAGE_NAME);

    const npm = tmpDir("xclaw-upd-npm-");
    const n = detectInstallKind(npm, { which: (name) => name === "npm" });
    assert.equal(n.kind, "npm");
    assert.equal(n.manager, "npm");

    const pn = detectInstallKind(npm, { which: (name) => name === "pnpm" });
    assert.equal(pn.manager, "pnpm");

    const bun = detectInstallKind(npm, { which: (name) => name === "bun" });
    assert.equal(bun.manager, "bun");

    const none = detectInstallKind(npm, { which: () => false });
    assert.equal(none.kind, "npm");
    assert.equal(none.manager, "npm");
  });

  it("evalSuiteInFlight is true only when running suite is later than done", () => {
    assert.equal(evalSuiteInFlight(""), false);
    assert.equal(evalSuiteInFlight("===== eval 2026-09-08 passRate=0.8 =====\n"), false);
    assert.equal(
      evalSuiteInFlight("[xclaw:eval-cron] running suite…\n[xclaw:eval-cron] done ok=true passRate=0.8\n"),
      false
    );
    assert.equal(
      evalSuiteInFlight("[xclaw:eval-cron] done ok=true\n[xclaw:eval-cron] running suite…\n"),
      true
    );
    assert.equal(
      evalSuiteInFlight("===== eval 2026-09-08 SKIP no key =====\n[xclaw:eval-cron] running suite…\n"),
      true
    );
  });

  it("--dry-run does not spawn git or npm", async () => {
    const git = tmpDir("xclaw-upd-dry-");
    fs.mkdirSync(path.join(git, ".git"));
    const calls = [];
    const out = await runUpdate({
      cwd: git,
      args: ["--dry-run"],
      spawnImpl: (cmd, a) => {
        calls.push([cmd, ...a]);
        return { status: 0, stdout: "", stderr: "" };
      },
      runDoctorImpl: async () => {
        throw new Error("doctor must not run on dry-run");
      },
      restartImpl: async () => {
        throw new Error("restart must not run on dry-run");
      },
    });
    assert.equal(out.ok, true);
    assert.equal(out.dryRun, true);
    assert.equal(out.kind, "git");
    assert.deepEqual(calls, []);
    assert.equal(out.doctor, null);
    assert.equal(out.restarted, false);
  });

  it("skips a dirty git tree without mutating", async () => {
    const git = tmpDir("xclaw-upd-dirty-");
    const r = await execFileP("git", ["init"], { cwd: git });
    assert.equal(r.stderr.includes("Initialized") || r.stdout.includes("Initialized") || true, true);
    fs.writeFileSync(path.join(git, "tracked.txt"), "x\n");
    await execFileP("git", ["add", "tracked.txt"], { cwd: git });
    await execFileP("git", ["-c", "user.email=t@t", "-c", "user.name=t", "commit", "-m", "i"], {
      cwd: git,
    });
    fs.writeFileSync(path.join(git, "tracked.txt"), "dirty\n");
    const calls = [];
    const out = await runUpdate({
      cwd: git,
      args: [],
      spawnImpl: (cmd, a) => {
        calls.push([cmd, ...a]);
        return { status: 0, stdout: "", stderr: "" };
      },
    });
    assert.equal(out.ok, false);
    assert.equal(out.skipped, "dirty");
    assert.match(out.error, /dirty/);
    assert.deepEqual(calls, []);
  });

  it("--no-restart never restarts even when eval is idle", async () => {
    const git = tmpDir("xclaw-upd-nr-");
    fs.mkdirSync(path.join(git, ".git"));
    let restarts = 0;
    const out = await runUpdate({
      cwd: git,
      args: ["--no-restart"],
      spawnImpl: () => ({ status: 0, stdout: "", stderr: "" }),
      readLogs: () => "[xclaw:eval-cron] done ok=true passRate=1\n",
      runDoctorImpl: async () => ({ ok: true, exitCode: 0 }),
      restartImpl: async () => {
        restarts += 1;
        return { restarted: true };
      },
    });
    assert.equal(out.ok, true);
    assert.equal(out.restarted, false);
    assert.equal(out.restartSkipped, "no_restart");
    assert.equal(restarts, 0);
    assert.equal(out.doctor.ok, true);
  });

  it("refuses restart while eval suite is running", async () => {
    const git = tmpDir("xclaw-upd-eval-");
    fs.mkdirSync(path.join(git, ".git"));
    let restarts = 0;
    const out = await runUpdate({
      cwd: git,
      args: [],
      spawnImpl: () => ({ status: 0, stdout: "", stderr: "" }),
      readLogs: () => "[xclaw:eval-cron] running suite…\n",
      runDoctorImpl: async () => ({ ok: true, exitCode: 0 }),
      restartImpl: async () => {
        restarts += 1;
        return { restarted: true };
      },
    });
    assert.equal(out.ok, true);
    assert.equal(out.evalSuiteInFlight, true);
    assert.equal(out.restarted, false);
    assert.equal(out.restartSkipped, "eval_suite_in_flight");
    assert.equal(restarts, 0);
  });

  it("unpublished npm package fails clean without install", async () => {
    const dir = tmpDir("xclaw-upd-unpub-");
    const calls = [];
    const out = await runUpdate({
      cwd: dir,
      args: [],
      whichImpl: (n) => n === "npm",
      spawnImpl: (cmd, a) => {
        calls.push([cmd, ...a]);
        if (a[0] === "view") {
          return { status: 1, stdout: "", stderr: "npm error 404 Not Found - GET https://registry.npmjs.org/xclaw" };
        }
        return { status: 0, stdout: "", stderr: "" };
      },
      runDoctorImpl: async () => {
        throw new Error("doctor must not run on unpublished");
      },
    });
    assert.equal(out.ok, false);
    assert.equal(out.kind, "npm");
    assert.equal(out.skipped, "unpublished");
    assert.match(out.error, /not on the registry/);
    assert.equal(calls.length, 1);
    assert.deepEqual(calls[0], ["npm", "view", PACKAGE_NAME, "version"]);
  });

  it("help lists update and the module has no forbidden vendor string", async () => {
    const home = tmpDir("xclaw-upd-help-");
    const r = await execFileP(process.execPath, [CLI, "help"], {
      env: { ...process.env, HOME: home, XDG_CONFIG_HOME: path.join(home, ".config") },
      timeout: 30_000,
    });
    assert.match(r.stdout, /\bupdate\b/);
    assert.match(r.stdout, /--dry-run/);
    assert.match(r.stdout, /--no-restart/);
    const help = updateHelpText();
    assert.match(help, /xclaw update/);
    const needle = ["open", "claw"].join("");
    assert.equal(SRC.toLowerCase().includes(needle), false, "src/cli/update.mjs must stay vendor-clean");
    assert.equal(TEST_SRC.toLowerCase().includes(needle), false, "test/update-cli.test.mjs must stay vendor-clean");
  });

  it("README 15-minute start and INSTALL lead with git clone, not unpublished npm global", () => {
    const readme = fs.readFileSync(path.join(REPO, "README.md"), "utf8");
    const install = fs.readFileSync(path.join(REPO, "INSTALL.md"), "utf8");
    const fifteen = readme.split("## 15-minute start")[1].split("\n## ")[0];
    const fence = fifteen.split("```bash")[1].split("```")[0];
    assert.match(fence, /git clone https:\/\/github.com\/Matrixx0070\/xclaw\.git/);
    const liveLines = fence
      .split("\n")
      .map((l) => l.trim())
      .filter((l) => l && !l.startsWith("#"));
    assert.equal(
      liveLines.some((l) => l.includes("npm install -g xclaw")),
      false,
      "15-minute live commands must not lead with unpublished npm global"
    );
    const ghIdx = install.indexOf("## Install from GitHub");
    const npmIdx = install.indexOf("## Install from npm");
    assert.ok(ghIdx >= 0, "INSTALL.md must have a GitHub section");
    assert.ok(npmIdx < 0 || ghIdx < npmIdx, "INSTALL.md must lead with GitHub before npm");
    assert.match(install, /unpublished/);
  });

  it("README H2 headings are unique and CONTRIBUTING.md exists", () => {
    const readme = fs.readFileSync(path.join(REPO, "README.md"), "utf8");
    const heads = readme.split("\n").filter((l) => l.startsWith("## "));
    const counts = new Map();
    for (const h of heads) counts.set(h, (counts.get(h) || 0) + 1);
    const dups = [...counts.entries()].filter(([, n]) => n > 1);
    assert.deepEqual(dups, []);
    assert.ok(heads.includes("## 15-minute start"));
    assert.ok(heads.includes("## Secrets"));
    assert.ok(heads.includes("## Profiles"));
    assert.ok(heads.includes("## Computer server (single engine)"));
    const contribPath = path.join(REPO, "CONTRIBUTING.md");
    assert.equal(fs.existsSync(contribPath), true);
    const contrib = fs.readFileSync(contribPath, "utf8");
    assert.match(contrib, /npm test/);
    assert.match(contrib, /git add -A/);
    const needle = ["open", "claw"].join("");
    assert.equal(contrib.toLowerCase().includes(needle), false, "CONTRIBUTING.md must stay vendor-clean");
  });
});
