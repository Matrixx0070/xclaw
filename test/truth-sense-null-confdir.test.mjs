/**
 * Leftover of 3.515.0: truth/sense still mkdir/join a nullable mitmConfdir.
 *
 * After `mitmConfdir()` can return null, `savePolicy` / `exportProofBundle` /
 * `bindActionFlows` still `fs.mkdir(confdir)` and `path.join(confdir, ...)`.
 * Node `path.join(null, "proofs")` becomes `"null/proofs"` in cwd. Same trap
 * as 3.514.0 control-plane mkdir(null) and 3.515.0 ensureMitmConfdir.
 *
 * Loop `afterBrowserToolTruth(name, result)` dropped cfg even though
 * `runAgentLoop` has it in scope — truth-auto would load policy from a null
 * confdir when MITM is on. Hooks afterAction already threaded cfg into
 * bindActionFlows but dropped it into afterBrowserToolTruth.
 *
 * Home fallback is refused. A cfg without configDir is never a real caller.
 * Production already threads cfg into savePolicy / exportProofBundle /
 * bindActionFlows; loop and hooks must thread cfg into afterBrowserToolTruth
 * so live still loads policy under configDir when truth-auto is on.
 */
import { test, describe, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { savePolicy, loadPolicy, exportProofBundle } from "../src/browser/truth.mjs";
import { bindActionFlows, readActionBindings } from "../src/browser/sense.mjs";

const HOME_DIR = path.join(os.homedir(), ".xclaw", "mitm");
const SAVED_MITM_CONFDIR = process.env.XCLAW_MITM_CONFDIR;
const SAVED_STATE_DIR = process.env.XCLAW_STATE_DIR;
delete process.env.XCLAW_MITM_CONFDIR;
delete process.env.XCLAW_STATE_DIR;

async function tmpDir() {
  return fsp.mkdtemp(path.join(os.tmpdir(), "xclaw-truth-null-"));
}

function cwdNullPaths() {
  return {
    dir: path.join(process.cwd(), "null"),
    policy: path.join(process.cwd(), "null", "policy.json"),
    proofs: path.join(process.cwd(), "null", "proofs"),
    bindings: path.join(process.cwd(), "null", "action-bindings.jsonl"),
  };
}

describe("truth/sense no-op a null mitm confdir", () => {
  after(() => {
    if (SAVED_MITM_CONFDIR === undefined) delete process.env.XCLAW_MITM_CONFDIR;
    else process.env.XCLAW_MITM_CONFDIR = SAVED_MITM_CONFDIR;
    if (SAVED_STATE_DIR === undefined) delete process.env.XCLAW_STATE_DIR;
    else process.env.XCLAW_STATE_DIR = SAVED_STATE_DIR;
  });

  test("a write lands in the config dir and never touches the home dir", async () => {
    const dir = await tmpDir();
    const homeBefore = fs.existsSync(HOME_DIR);
    const homeListing = homeBefore ? fs.readdirSync(HOME_DIR).sort() : null;
    const cfg = { paths: { configDir: dir } };
    const expected = path.join(dir, "mitm");

    const saved = await savePolicy(
      { version: 1, rules: [{ id: "r1", action: "block", match: { hostContains: "x" } }] },
      cfg,
    );
    assert.equal(saved.ok, true);
    assert.equal(saved.path, path.join(expected, "policy.json"));
    assert.equal(fs.existsSync(saved.path), true);

    const loaded = await loadPolicy(cfg);
    assert.ok(loaded.rules.some((r) => r.id === "r1"));

    const rec = await bindActionFlows("act_cfg", [{ method: "GET", host: "h", path: "/" }], { cfg });
    assert.equal(rec.actionId, "act_cfg");
    assert.equal(fs.existsSync(path.join(expected, "action-bindings.jsonl")), true);
    const bindings = await readActionBindings({ cfg, limit: 10 });
    assert.equal(bindings.length, 1);
    assert.equal(bindings[0].actionId, "act_cfg");

    const exported = await exportProofBundle({ cfg, limit: 10 });
    assert.equal(exported.ok, true);
    assert.ok(String(exported.path).startsWith(path.join(expected, "proofs") + path.sep));
    assert.equal(fs.existsSync(exported.path), true);

    const homeAfter = fs.existsSync(HOME_DIR);
    assert.equal(homeAfter, homeBefore, "configDir write wrote the home mitm dir");
    if (homeBefore) {
      assert.deepEqual(fs.readdirSync(HOME_DIR).sort(), homeListing, "configDir write mutated the home mitm dir");
    }
  });

  test("with no configDir there is NO home fallback — never writes home or cwd/null", async () => {
    const homeBefore = fs.existsSync(HOME_DIR);
    const homeListing = homeBefore ? fs.readdirSync(HOME_DIR).sort() : null;
    const n = cwdNullPaths();
    const cwdBefore = {
      dir: fs.existsSync(n.dir),
      policy: fs.existsSync(n.policy),
      proofs: fs.existsSync(n.proofs),
      bindings: fs.existsSync(n.bindings),
    };

    const saved = await savePolicy({ version: 1, rules: [{ id: "r1", action: "block" }] }, {});
    assert.equal(saved.ok, false);
    assert.equal(saved.code, "MITM_NO_CONFDIR");
    assert.equal(saved.path, null);

    const loaded = await loadPolicy({});
    assert.equal(Array.isArray(loaded.rules), true);

    const rec = await bindActionFlows("act_null", [{ method: "GET", host: "h" }], {});
    assert.equal(rec.actionId, "act_null");
    assert.deepEqual(await readActionBindings({}), []);

    const exported = await exportProofBundle({ limit: 10 });
    assert.equal(exported.ok, false);
    assert.equal(exported.code, "MITM_NO_CONFDIR");
    assert.equal(exported.path, null);

    const destDir = await tmpDir();
    const dest = path.join(destDir, "explicit-proof.json");
    const dested = await exportProofBundle({ dest, limit: 10 });
    assert.equal(dested.ok, true);
    assert.equal(dested.path, dest);
    assert.equal(fs.existsSync(dest), true);

    const homeAfter = fs.existsSync(HOME_DIR);
    assert.equal(homeAfter, homeBefore, "no-configDir wrote the home mitm dir");
    if (homeBefore) {
      assert.deepEqual(fs.readdirSync(HOME_DIR).sort(), homeListing, "no-configDir mutated the home mitm dir");
    }
    assert.equal(fs.existsSync(n.dir), cwdBefore.dir, "no-configDir wrote cwd/null");
    assert.equal(fs.existsSync(n.policy), cwdBefore.policy, "no-configDir wrote cwd/null/policy.json");
    assert.equal(fs.existsSync(n.proofs), cwdBefore.proofs, "no-configDir wrote cwd/null/proofs");
    assert.equal(fs.existsSync(n.bindings), cwdBefore.bindings, "no-configDir wrote cwd/null/action-bindings.jsonl");
  });

  test("loop and hooks thread cfg into afterBrowserToolTruth", () => {
    const loop = fs.readFileSync(new URL("../src/agent/loop.mjs", import.meta.url), "utf8");
    assert.match(loop, /afterBrowserToolTruth\(name, result, \{ cfg \}\)/);

    const hooks = fs.readFileSync(new URL("../src/browser/hooks.mjs", import.meta.url), "utf8");
    assert.match(hooks, /afterBrowserToolTruth\([\s\S]*?\{ cfg: ctx\.cfg \|\| null \}\)/);

    const truth = fs.readFileSync(new URL("../src/browser/truth.mjs", import.meta.url), "utf8");
    const save = truth.slice(truth.indexOf("export async function savePolicy"), truth.indexOf("export function matchRule"));
    assert.match(save, /if \(!confdir\)/);
    assert.match(save, /MITM_NO_CONFDIR/);

    const sense = fs.readFileSync(new URL("../src/browser/sense.mjs", import.meta.url), "utf8");
    const bind = sense.slice(sense.indexOf("export async function bindActionFlows"), sense.indexOf("function compactFlow"));
    assert.match(bind, /if \(confdir\)/);
  });
});
