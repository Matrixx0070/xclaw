/**
 * Point-and-prompt routes — element → source → change → rebuild → verify.
 *
 * The "point" step drives the OPERATOR's own browser (the Control browser on
 * the display, CDP loopback) — a one-shot picker overlay is injected into the
 * target page and the clicked element's descriptor is returned. The resolver
 * ranks likely source locations lexically; the mission engine does the
 * change→rebuild→verify part with the resolved locations pinned in the goal.
 *
 * Paths (operator-token gated in both auth modes):
 *   POST /point/pick     {urlFilter?, url?, cdpPort?, timeoutMs?} → {element}
 *   POST /point/resolve  {repoDir, element}                       → {matches}
 *   POST /point/mission  {repoDir, element, prompt, strategy?, verify?} → {mission}
 */
import { broadcast as wsBroadcast } from "../ws-hub.mjs";
import { createCdpClient } from "../../browser/cdp-client.mjs";
import { resolveElementSource, PICKER_JS } from "../../intel/element-resolver.mjs";

const emitWs = (e) => {
  try {
    wsBroadcast("mission", e);
  } catch {
    /* hub optional */
  }
};

/** Build the mission goal from prompt + element + resolved locations. */
export function buildPointGoal(prompt, element, matches = []) {
  const lines = [
    String(prompt || "").trim(),
    "",
    "TARGET ELEMENT (picked from the running app):",
    JSON.stringify(
      {
        tag: element.tag,
        selector: element.selector,
        id: element.id || undefined,
        classes: element.classes?.length ? element.classes : undefined,
        text: element.text || undefined,
        attrs: Object.keys(element.attrs || {}).length ? element.attrs : undefined,
        url: element.url || undefined,
      },
      null,
      0
    ),
  ];
  if (matches.length) {
    lines.push(
      "",
      "LIKELY SOURCE LOCATIONS (lexically resolved from the element — start here):",
      ...matches.map((m) => `- ${m.file}:${m.line} (${m.matchedOn.join(", ")})`)
    );
  }
  lines.push(
    "",
    "Make the requested change at the real source of this element, then rebuild/run the project's checks to prove it."
  );
  return lines.join("\n");
}

export async function tryHandlePointRoute({ p, method, res, cfg, json, readBody, req }) {
  if (!p.startsWith("/point")) return false;

  if (p === "/point/pick" && method === "POST") {
    const body = await readBody(req).catch(() => ({}));
    const port = Number(body.cdpPort || cfg.point?.cdpPort || 9224);
    const timeoutMs = Math.min(Number(body.timeoutMs || 90_000), 300_000);
    let attached = null;
    try {
      const cdp = createCdpClient({ port });
      // NEVER pick inside the Control UI page — the pick request comes from
      // there and navigating it would kill the awaiting fetch. Prefer, in
      // order: a page matching urlFilter → a page already on body.url → a
      // fresh tab (when body.url given) → any non-control page.
      const pages = await cdp.listPages();
      const isControl = (pg) => /\/control(\/|$|#)/.test(String(pg.url || ""));
      let target = null;
      if (body.urlFilter) target = pages.find((pg) => String(pg.url || "").includes(body.urlFilter) && !isControl(pg));
      if (!target && body.url) target = pages.find((pg) => String(pg.url || "").startsWith(String(body.url)));
      if (!target && body.url) {
        await cdp.newPage(String(body.url));
        await new Promise((r) => setTimeout(r, 1800));
        const fresh = await cdp.listPages();
        target = fresh.find((pg) => String(pg.url || "").startsWith(String(body.url))) || fresh.find((pg) => !isControl(pg));
      }
      if (!target) target = pages.find((pg) => !isControl(pg));
      if (!target) {
        json(res, 400, { ok: false, error: "no pickable page (open the app in a tab or pass url)" });
        return true;
      }
      attached = await cdp.attach((pg) => pg.id === target.id);
      const armed = await attached.evaluate(PICKER_JS);
      const deadline = Date.now() + timeoutMs;
      let element = null;
      while (Date.now() < deadline) {
        await new Promise((r) => setTimeout(r, 700));
        const v = await attached.evaluate("JSON.stringify(window.__xclawPick || null)");
        if (v && v !== "null") {
          element = JSON.parse(v);
          break;
        }
      }
      if (!element) {
        json(res, 408, { ok: false, error: "no element picked before timeout", armed });
        return true;
      }
      if (element.cancelled) {
        json(res, 200, { ok: false, cancelled: true });
        return true;
      }
      json(res, 200, { ok: true, element, page: { url: attached.page.url, title: attached.page.title } });
    } catch (e) {
      json(res, 502, { ok: false, error: `picker: ${e.message}` });
    } finally {
      try {
        attached?.close();
      } catch {}
    }
    return true;
  }

  if (p === "/point/resolve" && method === "POST") {
    const body = await readBody(req).catch(() => ({}));
    if (!body.repoDir || !body.element) {
      json(res, 400, { ok: false, error: "repoDir and element required" });
      return true;
    }
    try {
      const r = await resolveElementSource(String(body.repoDir), body.element);
      json(res, 200, { ok: true, ...r });
    } catch (e) {
      json(res, 400, { ok: false, error: e.message });
    }
    return true;
  }

  if (p === "/point/mission" && method === "POST") {
    const body = await readBody(req).catch(() => ({}));
    if (!body.repoDir || !body.element || !body.prompt) {
      json(res, 400, { ok: false, error: "repoDir, element and prompt required" });
      return true;
    }
    try {
      const engine = await import("../../missions/engine.mjs");
      const { matches } = await resolveElementSource(String(body.repoDir), body.element);
      const goal = buildPointGoal(body.prompt, body.element, matches);
      const mission = await engine.startMission(cfg, {
        goal,
        repoDir: body.repoDir,
        strategy: body.strategy === "swarm" ? "swarm" : undefined,
        verify: Array.isArray(body.verify) ? body.verify : null,
        onEvent: emitWs,
      });
      json(res, 200, {
        ok: true,
        mission: { id: mission.id, status: mission.status, strategy: mission.strategy },
        matches,
      });
    } catch (e) {
      json(res, 400, { ok: false, error: e.message });
    }
    return true;
  }

  return false;
}
