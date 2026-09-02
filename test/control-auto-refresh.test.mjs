import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createRefreshGate, REFRESH_LABEL } from "../ui/control/auto-refresh.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

// The module is imported under node — the browser wiring must be inert here
// (no document), or this import itself would have thrown.

test("control auto-refresh gate", async (t) => {
  const clocked = (start = 0) => {
    let t0 = start;
    return { tick: (ms) => (t0 += ms), gate: createRefreshGate({ minGapMs: 5000, now: () => t0 }) };
  };

  await t.test("hidden skips interval and focus; nav and manual still fire", () => {
    const { gate } = clocked();
    // Live 2026-09-02 pid 2798540 (version 3.562.0) Control Chrome CDP 9224
    // had document.hidden === true while Display :10 painted. Nav/manual
    // must still stamp; interval/focus must not.
    assert.equal(gate.shouldFire("nav", { hidden: true }), true);
    assert.equal(gate.shouldFire("manual", { hidden: true }), true);
    assert.equal(gate.shouldFire("focus", { hidden: true }), false);
    assert.equal(gate.shouldFire("interval", { hidden: true }), false);
  });

  await t.test("the first interval tick fires — a fresh gate holds nothing back", () => {
    const { gate } = clocked(1000);
    assert.equal(gate.shouldFire("interval"), true);
  });

  await t.test("interval and focus respect the gap; nav and manual do not", () => {
    const { gate, tick } = clocked(1000);
    assert.equal(gate.shouldFire("interval"), true);
    tick(1000); // 1s later — inside the 5s gap
    assert.equal(gate.shouldFire("interval"), false);
    assert.equal(gate.shouldFire("focus"), false);
    // A human switching views or pressing Refresh is always honored.
    assert.equal(gate.shouldFire("nav"), true);
    assert.equal(gate.shouldFire("manual"), true);
  });

  await t.test("a nav fire re-arms the gap — the focus event riding the same click collapses", () => {
    const { gate, tick } = clocked(1000);
    assert.equal(gate.shouldFire("nav"), true);
    tick(10); // focus lands ~same instant as the nav
    assert.equal(gate.shouldFire("focus"), false);
    tick(5000);
    assert.equal(gate.shouldFire("focus"), true);
  });

  await t.test("after the gap passes, the interval fires again", () => {
    const { gate, tick } = clocked(1000);
    assert.equal(gate.shouldFire("interval"), true);
    tick(5001);
    assert.equal(gate.shouldFire("interval"), true);
  });

  await t.test("default state is visible — omitting state fires", () => {
    const { gate } = clocked();
    assert.equal(gate.shouldFire("nav"), true);
  });

  await t.test("the wiring re-fires buttons by the exact label the pages use", () => {
    assert.equal(REFRESH_LABEL, "Refresh");
  });
});

test("control auto-refresh wiring pins", () => {
  const html = fs.readFileSync(path.join(root, "ui/control/index.html"), "utf8");
  const app = fs.readFileSync(path.join(root, "ui/control/app.js"), "utf8");
  const wiring = fs.readFileSync(path.join(root, "ui/control/auto-refresh.mjs"), "utf8");

  // Usage, job history, and remote workers must use the exact label the
  // auto-refresh module re-clicks — any other text is silently excluded.
  assert.match(html, /id="ulRefresh">Refresh</);
  assert.match(html, /id="btnJobHistory">Refresh</);
  assert.match(html, /id="btnMwRefresh">Refresh</);

  // Stamp waits on refreshAll settling, including a failed fetch.
  assert.match(wiring, /refresh failed/);
  assert.match(wiring, /typeof window\.refreshAll === "function"/);
  assert.match(wiring, /stamp\(false\)/);
  assert.match(app, /window\.refreshAll = refreshAll/);
  assert.match(app, /stale — refresh failed/);

  // Pairing Approve/Revoke surface the error instead of swallowing it.
  assert.match(app, /pairTable[\s\S]{0,200}e\.message/);

  // Keyboard can open detail rows; credential pills are real buttons;
  // the busy-guard forwards the event so × delete can stopPropagation.
  assert.match(app, /function bindRowOpen/);
  assert.match(app, /e\.key === "Enter" \|\| e\.key === " "/);
  assert.match(app, /button type="button" class="\$\{cls\} prov-cred"/);
  assert.match(app, /class="prov-cred-del"/);
  assert.match(app, /const guard = \(fn\) => async \(ev\) =>/);
});

test("memory click drops placeholder so filled body is not muted", () => {
  const app = fs.readFileSync(path.join(root, "ui/control/app.js"), "utf8");
  const html = fs.readFileSync(path.join(root, "ui/control/index.html"), "utf8");
  const css = fs.readFileSync(path.join(root, "ui/control/styles.css"), "utf8");
  const mem = app.slice(
    app.indexOf("async function loadMemoryFilesUi"),
    app.indexOf("$(\"btnMemRefresh\")")
  );
  assert.match(mem, /out\.classList\.remove\("placeholder"\)/);
  assert.match(mem, /out\.textContent = f\?\.body/);
  // Empty-state before click stays — the class is the empty-state, not a lie.
  assert.match(html, /id="memOut" class="log placeholder"/);
  assert.match(html, /no output yet/);
  // CSS still mutes leftover placeholder — that is why the class must drop.
  const rule = css.slice(css.indexOf(".log.placeholder"), css.indexOf(".log.placeholder") + 120);
  assert.match(rule, /color:\s*var\(--muted\)/);
});

test("transcript Read drops placeholder so filled body is not muted", () => {
  const app = fs.readFileSync(path.join(root, "ui/control/app.js"), "utf8");
  const html = fs.readFileSync(path.join(root, "ui/control/index.html"), "utf8");
  const tr = app.slice(
    app.indexOf("async function loadTranscripts"),
    app.indexOf("$(\"btnTrRefresh\")")
  );
  assert.match(tr, /out\.classList\.remove\("placeholder"\)/);
  assert.match(tr, /out\.textContent = "loading…"/);
  assert.match(html, /id="trOut" class="log placeholder"/);
});
