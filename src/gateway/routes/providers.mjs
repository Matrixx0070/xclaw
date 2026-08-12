/**
 * Gateway provider-management HTTP routes (control-plane for the shared core
 * in src/providers/manage.mjs — same behavior as `xclaw providers …`).
 *
 * Paths (namespaced under /providers/manage so the existing GET /providers/route
 * read in routes/ops.mjs is untouched):
 *   GET    /providers/manage           → full inventory (no secrets, ever)
 *   POST   /providers/manage/base-url  → {provider, url|null} set/clear endpoint
 *   POST   /providers/manage/key       → {provider, apiKey[, name]} store key (never echoed)
 *   POST   /providers/manage/use       → {provider[, model]} select active
 *   POST   /providers/manage/models    → {provider} LIVE model list via the
 *          provider's own /models endpoint (uses the stored credential) — the
 *          UI's dropdown spine: paste key → real models → pick → use
 *   POST   /providers/manage/check     → {provider} live credential resolution
 *   DELETE /providers/manage/key       → {provider | profileId[, name]} remove profile
 *
 * OAuth login flows stay CLI-side (`xclaw providers oauth`) — a browser
 * round-trip with a PKCE verifier has no business in an unauthenticated-by-
 * default lab gateway.
 *
 * Config writes apply to NEW config loads (running agent loops keep their boot
 * snapshot) — responses say so.
 */
import {
  providerInventory,
  setProviderBaseUrl,
  setActiveProvider,
  checkProviderCredential,
} from "../../providers/manage.mjs";
import { loginApiKey, removeProfile, setAuthOrder, listProfiles } from "../../auth/profiles.mjs";

const APPLIES_NOTE = "applies to new agent runs (running loops keep their boot config)";

const LOOPBACK_HOSTS = new Set(["127.0.0.1", "localhost", "::1", "[::1]"]);

/**
 * A provider base URL decides where the stored credential is sent as a Bearer
 * header — an arbitrary rewrite is credential exfiltration. Allow only:
 *   https://<any host>            (TLS to a real API host)
 *   http://<loopback>[:port]/...  (local ollama / llama.cpp only)
 * @returns {string|null} error message, or null when acceptable
 */
function baseUrlProblem(url) {
  let u;
  try {
    u = new URL(url);
  } catch {
    return `invalid URL: ${url}`;
  }
  if (u.protocol === "https:") return null;
  if (u.protocol === "http:") {
    const host = u.hostname.toLowerCase();
    if (LOOPBACK_HOSTS.has(host)) return null;
    return "http:// base URLs are allowed only for loopback hosts (127.0.0.1/localhost/::1) — use https:// for remote APIs";
  }
  return `blocked scheme ${u.protocol} (https, or http to loopback, only)`;
}

/**
 * @param {object} args — standard route args
 * @returns {Promise<boolean>} true if handled
 */
export async function tryHandleProvidersRoute({ p, method, req, res, cfg, json, readBody }) {
  if (!p.startsWith("/providers/manage")) return false;

  try {
    if (p === "/providers/manage" && method === "GET") {
      json(res, 200, await providerInventory(cfg));
      return true;
    }

    if (p === "/providers/manage/base-url" && method === "POST") {
      const body = await readBody(req);
      if (!body.provider) {
        json(res, 400, { error: "provider required" });
        return true;
      }
      const raw = body.url ?? null;
      if (raw !== null && String(raw).trim()) {
        const problem = baseUrlProblem(String(raw).trim());
        if (problem) {
          json(res, 400, { error: problem });
          return true;
        }
      }
      const out = await setProviderBaseUrl(body.provider, raw);
      json(res, 200, { ...out, note: APPLIES_NOTE });
      return true;
    }

    if (p === "/providers/manage/key" && method === "POST") {
      const body = await readBody(req);
      if (!body.provider || !body.apiKey) {
        json(res, 400, { error: "provider and apiKey required" });
        return true;
      }
      // Stored under its own profile name so an API key NEVER clobbers an
      // OAuth login (OAuth lives at "<provider>:default"; keys at
      // "<provider>:apikey") — the two credentials coexist per provider.
      await loginApiKey(cfg, {
        provider: body.provider,
        name: body.name || "apikey",
        apiKey: body.apiKey,
      });
      // Never echo the key back.
      json(res, 200, { ok: true, provider: body.provider, note: APPLIES_NOTE });
      return true;
    }

    if (p === "/providers/manage/use" && method === "POST") {
      const body = await readBody(req);
      const out = await setActiveProvider(cfg, {
        provider: body.provider,
        model: body.model,
      });
      json(res, 200, { ...out, note: APPLIES_NOTE });
      return true;
    }

    if (p === "/providers/manage/models" && method === "POST") {
      const body = await readBody(req);
      if (!body.provider) {
        json(res, 400, { error: "provider required" });
        return true;
      }
      const { fetchLiveModels } = await import("../../providers/discovery.mjs");
      const r = await fetchLiveModels(cfg, body.provider, { force: true });
      json(res, 200, {
        ok: Boolean(r.ok),
        provider: body.provider,
        models: (r.models || []).map((m) => (typeof m === "string" ? m : m.id)),
        error: r.error || null,
      });
      return true;
    }

    if (p === "/providers/manage/check" && method === "POST") {
      const body = await readBody(req);
      if (!body.provider) {
        json(res, 400, { error: "provider required" });
        return true;
      }
      json(res, 200, await checkProviderCredential(cfg, body.provider));
      return true;
    }

    if (p === "/providers/manage/prefer" && method === "POST") {
      // Choose which stored credential (profile) resolves first for a provider
      // (e.g. prefer "<provider>:apikey" over the "<provider>:default" OAuth).
      const body = await readBody(req);
      if (!body.provider || !body.profileId) {
        json(res, 400, { error: "provider and profileId required" });
        return true;
      }
      const all = await listProfiles(cfg, body.provider);
      const rest = all.map((x) => x.id).filter((id) => id !== body.profileId);
      const out = await setAuthOrder(cfg, body.provider, [body.profileId, ...rest]);
      json(res, 200, { ...out, note: APPLIES_NOTE });
      return true;
    }

    if (p === "/providers/manage/key" && method === "DELETE") {
      const body = await readBody(req).catch(() => ({}));
      const target = body.profileId || body.provider;
      if (!target) {
        json(res, 400, { error: "provider or profileId required" });
        return true;
      }
      const out = await removeProfile(cfg, target, body.name);
      json(res, 200, { ok: true, removed: out?.removed ?? out ?? true });
      return true;
    }
  } catch (err) {
    json(res, 400, { error: err?.message || String(err) });
    return true;
  }

  return false;
}

export default { tryHandleProvidersRoute };
