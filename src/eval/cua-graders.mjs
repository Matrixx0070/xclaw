/**
 * I6 — CUA stack graders (offline / long-horizon policy chain).
 * Does not require live LLM; validates computer-use backend contracts.
 */
import {
  extractInteractiveElements,
  observeFromTab,
  runBrowserTab,
  _resetTabsForTests,
} from "../computer/modules/browser-tab-tool.mjs";
import {
  runComputerAct,
  cacheObserveResult,
  getCachedObserve,
} from "../computer/modules/computer-act-tool.mjs";
import { runDesktopAct, runDesktopObserve } from "../computer/modules/desktop-driver.mjs";
import { resolveReach } from "../agent/capability-reach.mjs";
import { getPlane, PARALLEL_SAFE, CUA_SERIAL_ACTUATION } from "../tools/planes.mjs";

/**
 * @returns {Promise<{ id: string, pass: boolean, detail?: string }[]>}
 */
export async function runCuaI6Suite() {
  const rows = [];

  // 01 observe native
  {
    const id = "cua-i6-01_observe_native";
    try {
      const html = `<a href="/x">Go</a><button>Save</button><input name="q" placeholder="Search"/>`;
      const els = extractInteractiveElements(html, "https://example.com");
      const obs = observeFromTab({
        id: "t1",
        url: "https://example.com",
        title: "T",
        text: "hi",
        html,
      });
      const pass = els.length >= 2 && obs.ok && obs.mode === "html-structure";
      rows.push({ id, pass, detail: `els=${els.length} mode=${obs.mode}` });
    } catch (e) {
      rows.push({ id, pass: false, detail: String(e?.message || e) });
    }
  }

  // 02 act fail closed
  {
    const id = "cua-i6-02_act_fail_closed";
    // Deterministic: dead loopback endpoint (external wins — never spawns
    // the managed Chrome) must fail typed, fast, and closed.
    process.env.XCLAW_CDP_URL = "http://127.0.0.1:59991";
    process.env.XCLAW_CUA_RETRIES = "0";
    const r = await runComputerAct({ action: "click", x: 1, y: 1 });
    delete process.env.XCLAW_CDP_URL;
    delete process.env.XCLAW_CUA_RETRIES;
    rows.push({
      id,
      pass: r.ok === false && r.code === "CDP_ATTACH_FAILED",
      detail: r.code,
    });
  }

  // 03 ref cache
  {
    const id = "cua-i6-03_ref_cache";
    cacheObserveResult("tab_i6", {
      elements: [{ ref: "e1", role: "button", name: "OK" }],
      url: "https://example.com",
    });
    const c = getCachedObserve("tab_i6");
    rows.push({
      id,
      pass: c?.elements?.[0]?.ref === "e1",
      detail: JSON.stringify(c?.elements?.[0] || null),
    });
  }

  // 04 desktop disabled
  {
    const id = "cua-i6-04_desktop_disabled";
    const r = await runDesktopAct({ action: "click", x: 1, y: 1 }, {});
    rows.push({
      id,
      pass: r.code === "DESKTOP_GUI_DISABLED",
      detail: r.code,
    });
  }

  // 05 desktop observe
  {
    const id = "cua-i6-05_desktop_observe";
    const r = await runDesktopObserve({ max: 5 });
    const okCodes = new Set([
      "ATSPI_NOT_INSTALLED",
      "ATSPI_REGISTRY_FAILED",
      "ATSPI_WALK_FAILED",
      "ATSPI_EMPTY",
      "ATSPI_HELPER_MISSING",
      "ATSPI_EXEC_FAILED",
      "ATSPI_BAD_JSON",
      "DESKTOP_OBSERVE_UNSUPPORTED_OS",
      "UIA_NOT_INSTALLED",
      "UIA_DESKTOP_FAILED",
      "UIA_WALK_FAILED",
      "UIA_HELPER_MISSING",
      "UIA_EXEC_FAILED",
      "UIA_EMPTY",
      "UIA_BAD_JSON",
    ]);
    const pass = r.ok === true || okCodes.has(r.code);
    rows.push({ id, pass, detail: r.ok ? `els=${r.elementCount}` : r.code });
  }

  // 06 reach policy
  {
    const id = "cua-i6-06_reach_policy";
    const r = resolveReach({});
    const pass =
      r.cuaPolicy === "tools_first_then_observe_then_gui" &&
      r.browserObserve === true &&
      r.desktopGui === false;
    rows.push({
      id,
      pass,
      detail: `policy=${r.cuaPolicy} observe=${r.browserObserve} desktop=${r.desktopGui}`,
    });
  }

  // 07 planes
  {
    const id = "cua-i6-07_serial_planes";
    const planeOk = getPlane("xclaw_computer_act") === "computer";
    const notParallel = !PARALLEL_SAFE.has("xclaw_computer_act");
    const serialSet =
      typeof CUA_SERIAL_ACTUATION !== "undefined" &&
      CUA_SERIAL_ACTUATION.has("xclaw_computer_act");
    rows.push({
      id,
      pass: planeOk && notParallel && serialSet,
      detail: `plane=${getPlane("xclaw_computer_act")} serial=${serialSet}`,
    });
  }

  // 08 multi-step policy chain (long-horizon contract)
  {
    const id = "cua-i6-08_multistep_policy";
    _resetTabsForTests();
    // Deterministic: dead external endpoint — CDP-tier actions fail typed,
    // never spawn the managed Chrome inside the grader.
    process.env.XCLAW_CDP_URL = "http://127.0.0.1:59991";
    process.env.XCLAW_CUA_RETRIES = "0";
    // step1: click against an unreachable browser fails closed
    const a1 = await runComputerAct({ action: "click", ref: "e1", tabId: "t" });
    // step2: observe path exists without any browser
    const html = `<button>Next</button>`;
    const obs = observeFromTab({ id: "t", url: "https://ex.com", title: "", text: "", html });
    cacheObserveResult("t", obs);
    // step3: desktop without opt-in still blocked
    const a3 = await runComputerAct({ surface: "desktop", action: "click", x: 1, y: 1 });
    // step4: screenshot against an unreachable browser fails typed
    const shot = await runBrowserTab({ screenshot: "full" });
    delete process.env.XCLAW_CDP_URL;
    delete process.env.XCLAW_CUA_RETRIES;
    const pass =
      a1.ok === false &&
      obs.ok === true &&
      a3.code === "DESKTOP_GUI_DISABLED" &&
      shot.ok === false;
    rows.push({
      id,
      pass,
      detail: `act=${a1.code} obs=${obs.elementCount} desk=${a3.code} shot=${shot.code}`,
    });
  }

  return rows;
}

export function summarizeCuaRows(rows) {
  const pass = rows.filter((r) => r.pass).length;
  return {
    total: rows.length,
    pass,
    fail: rows.length - pass,
    passRate: rows.length ? pass / rows.length : 0,
    rows,
  };
}
