/**
 * Gateway hook-system routes.
 *
 * Paths:
 *   GET    /hooks           — registered hooks + config state
 *   GET    /hooks/history   — execution log (ring buffer)
 *   POST   /hooks/toggle    — {enabled} or {category, enabled} (persisted)
 *   POST   /hooks/commands  — add a command hook (persisted + hot-applied)
 *   DELETE /hooks/commands  — {name} remove (persisted + hot-applied)
 */
import { saveConfigPatch } from "../../config/load.mjs";
import {
  getSharedHookManager,
  resetSharedHookManager,
  HOOK_CATEGORIES,
  HOOK_TIERS,
} from "../../hooks/manager.mjs";

/** @returns {Promise<boolean>} true if handled */
export async function tryHandleHooksRoute({ p, method, req, res, url, cfg, json, readBody }) {
  if (p === "/hooks" && method === "GET") {
    const m = getSharedHookManager(cfg);
    await m._ensureModules().catch(() => {});
    json(res, 200, {
      enabled: cfg.hooks?.enabled !== false,
      categories: Object.fromEntries(
        HOOK_CATEGORIES.map((c) => [c, cfg.hooks?.categories?.[c] !== false])
      ),
      timeoutMs: m.timeoutMs,
      stopBlockCap: cfg.hooks?.stopBlockCap ?? 2,
      hooks: m.listHooks(),
      commands: (cfg.hooks?.commands || []).map((c) => ({
        name: c.name || `cmd:${String(c.command).slice(0, 40)}`,
        event: c.event,
        matcher: c.matcher || null,
        tier: c.tier || "user",
        command: c.command,
        timeoutMs: c.timeoutMs || null,
      })),
      modules: (cfg.hooks?.modules || []).map((e) =>
        typeof e === "string" ? { path: e, tier: "user" } : { path: e.path, tier: e.tier || "user" }
      ),
      tiers: HOOK_TIERS,
      categoriesAll: HOOK_CATEGORIES,
    });
    return true;
  }
  if (p === "/hooks/history" && method === "GET") {
    const m = getSharedHookManager(cfg);
    json(res, 200, {
      history: m.history(Number(url.searchParams.get("limit") || 50)),
    });
    return true;
  }
  if (p === "/hooks/toggle" && method === "POST") {
    const body = await readBody(req).catch(() => ({}));
    const enabled = body.enabled !== false;
    if (body.category) {
      if (!HOOK_CATEGORIES.includes(body.category)) {
        json(res, 400, { error: `unknown category ${body.category}` });
        return true;
      }
      await saveConfigPatch({ hooks: { categories: { [body.category]: enabled } } });
      cfg.hooks = cfg.hooks || {};
      cfg.hooks.categories = { ...(cfg.hooks.categories || {}), [body.category]: enabled };
    } else {
      await saveConfigPatch({ hooks: { enabled } });
      cfg.hooks = { ...(cfg.hooks || {}), enabled };
    }
    json(res, 200, { ok: true, enabled, category: body.category || null });
    return true;
  }
  if (p === "/hooks/commands" && method === "POST") {
    const body = await readBody(req).catch(() => ({}));
    if (!HOOK_CATEGORIES.includes(body.event)) {
      json(res, 400, { error: `event must be one of ${HOOK_CATEGORIES.join(", ")}` });
      return true;
    }
    if (!body.command || typeof body.command !== "string") {
      json(res, 400, { error: "command required" });
      return true;
    }
    if (body.tier && !HOOK_TIERS.includes(body.tier)) {
      json(res, 400, { error: `tier must be one of ${HOOK_TIERS.join(", ")}` });
      return true;
    }
    const entry = {
      name: String(body.name || `cmd-${Date.now().toString(36)}`).slice(0, 60),
      event: body.event,
      command: String(body.command),
      ...(body.matcher ? { matcher: String(body.matcher) } : {}),
      tier: body.tier || "user",
      ...(Number(body.timeoutMs) > 0 ? { timeoutMs: Number(body.timeoutMs) } : {}),
    };
    const commands = [...(cfg.hooks?.commands || [])];
    if (commands.some((c) => c.name === entry.name)) {
      json(res, 400, { error: `command hook "${entry.name}" already exists` });
      return true;
    }
    commands.push(entry);
    await saveConfigPatch({ hooks: { commands } });
    cfg.hooks = { ...(cfg.hooks || {}), commands };
    resetSharedHookManager(cfg); // hot-apply: next run picks it up
    json(res, 200, { ok: true, added: entry });
    return true;
  }
  if (p === "/hooks/commands" && method === "DELETE") {
    const body = await readBody(req).catch(() => ({}));
    const commands = (cfg.hooks?.commands || []).filter((c) => c.name !== body.name);
    if (commands.length === (cfg.hooks?.commands || []).length) {
      json(res, 404, { error: `command hook "${body.name}" not found` });
      return true;
    }
    await saveConfigPatch({ hooks: { commands } });
    cfg.hooks = { ...(cfg.hooks || {}), commands };
    resetSharedHookManager(cfg);
    json(res, 200, { ok: true });
    return true;
  }
  return false;
}

export default { tryHandleHooksRoute };
