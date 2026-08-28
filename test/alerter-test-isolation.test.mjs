/**
 * No test may build an alerter that writes the operator's alert history.
 *
 * `send()` persists on EVERY path — `disabled`, `no_targets`,
 * `below_min_severity`, `cooldown` — so a test that merely asserts
 * `skipped === "no_targets"` still writes a file. Without `paths.configDir` or
 * `alerting.statePath` that file is the real `~/.xclaw/alert-state.json`.
 *
 * This is not hypothetical. `test/alerting-b4.test.mjs` put two entries
 * (`live-e2e:live.commit_gate`, `enforcement:a.bundle_navigate_hook`) into the
 * live box's alert history during a suite run, and an earlier run's 100
 * `no_targets` entries were mistaken for evidence of a production defect while
 * diagnosing v3.295.0. Corrupting the record you diagnose outages from is worse
 * than having no record.
 *
 * The rule is deliberately narrow so it never misfires: an INLINE config
 * literal that configures alerting must also name where the state goes. A call
 * that passes an identifier or a helper call (`cfgTmp()`, `isolatedCfg()`) is
 * not inspected — this check reads text, not values, and a rule that guessed at
 * indirection would produce false positives that future authors silence with
 * the opt-out marker, which would cost more than it catches.
 *
 * Deliberate exceptions carry `alerter-home-fallback-ok` on the call or the
 * line above it — the home path is still the correct default for a normal
 * install, and something has to pin that.
 */
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const SELF = fileURLToPath(import.meta.url);
const TEST_DIR = path.dirname(SELF);
const CTORS = /\b(createAlerter|getSharedAlerter|resetSharedAlerter)\s*\(/g;
const MARKER = "alerter-home-fallback-ok";

/** Text of the argument list starting at the call's open paren, paren-balanced. */
function argsAt(src, openParen) {
  let depth = 0;
  let quote = null;
  for (let i = openParen; i < src.length; i += 1) {
    const c = src[i];
    if (quote) {
      if (c === "\\") i += 1;
      else if (c === quote) quote = null;
      continue;
    }
    if (c === '"' || c === "'" || c === "`") quote = c;
    else if (c === "(") depth += 1;
    else if (c === ")") {
      depth -= 1;
      if (depth === 0) return src.slice(openParen + 1, i);
    }
  }
  return src.slice(openParen + 1);
}

function offenders(src, file) {
  const lines = src.split("\n");
  const found = [];
  for (const m of src.matchAll(CTORS)) {
    const open = m.index + m[0].length - 1;
    const args = argsAt(src, open);
    // Only inline literals that configure alerting are in scope.
    if (!/^\s*\{/.test(args)) continue;
    if (!/\b(alerting|alerts)\s*:/.test(args)) continue;
    if (/\b(configDir|statePath)\b/.test(args)) continue;
    const line = src.slice(0, m.index).split("\n").length;
    const context = [lines[line - 2] || "", lines[line - 1] || "", args].join("\n");
    if (context.includes(MARKER)) continue;
    found.push(`${file}:${line} ${m[1]}(...)`);
  }
  return found;
}

describe("alerter state isolation in tests", () => {
  test("no test builds an alerter that writes the operator's alert history", () => {
    const found = [];
    for (const name of fs.readdirSync(TEST_DIR).sort()) {
      // This file's own offenders are fixture STRINGS for the check below, and
      // it is the one test file that never constructs a live alerter.
      if (!name.endsWith(".mjs") || name === path.basename(SELF)) continue;
      found.push(...offenders(fs.readFileSync(path.join(TEST_DIR, name), "utf8"), name));
    }
    assert.deepEqual(
      found,
      [],
      `alerter built with no paths.configDir / alerting.statePath — send() would write ` +
        `~/.xclaw/alert-state.json:\n  ${found.join("\n  ")}`
    );
  });

  test("the check actually fires, and the opt-out actually opts out", () => {
    const bad = `createAlerter({ alerting: { enabled: true, targets: [] } });`;
    assert.equal(offenders(bad, "x.mjs").length, 1, "unisolated alerter config not detected");

    assert.deepEqual(offenders(`${bad} // ${MARKER}`, "x.mjs"), [], "opt-out marker ignored");
    assert.deepEqual(
      offenders(`// ${MARKER}\n${bad}`, "x.mjs"),
      [],
      "opt-out marker on the preceding line ignored"
    );
    assert.deepEqual(
      offenders(`createAlerter({ paths: { configDir: d }, alerting: { enabled: true } });`, "x.mjs"),
      [],
      "an isolated alerter was flagged"
    );
    assert.deepEqual(
      offenders(`createAlerter({ alerting: { enabled: true, statePath: p } });`, "x.mjs"),
      [],
      "an explicit statePath was flagged"
    );
    // Indirection is out of scope by design, not by accident.
    assert.deepEqual(offenders(`createAlerter(await cfgTmp());`, "x.mjs"), []);
    assert.deepEqual(offenders(`resetSharedAlerter({});`, "x.mjs"), []);
  });
});
