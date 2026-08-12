/**
 * Gateway JWKS public + invalidation HTTP routes (extracted from index.mjs).
 *
 * Paths:
 *   GET  /xclaw/jwks.json · /.well-known/jwks.json · /jwks.json
 *   GET  /xclaw/jwks/epoch · /xclaw/jwks/cache
 *   POST /xclaw/jwks/invalidate
 */

/**
 * @param {object} args
 * @returns {Promise<boolean>} true if handled
 */
export async function tryHandleJwksRoute({ p, method, req, res, url, cfg, json, readBody }) {
  if (
    (p === "/xclaw/jwks.json" ||
      p === "/.well-known/jwks.json" ||
      p === "/jwks.json") &&
    method === "GET"
  ) {
    const { getJwksCached, exportJwks } = await import("../../auth/jwks.mjs");
    const force = url.searchParams.get("force") === "1";
    const out = force
      ? await exportJwks(cfg)
      : await getJwksCached(cfg, { force: false });
    const etag = out.etag || out.exportedAt;
    const inm = req.headers["if-none-match"];
    if (inm && etag && inm.replace(/"/g, "") === String(etag)) {
      res.writeHead(304, {
        ETag: `"${etag}"`,
        "Cache-Control": "public, max-age=60",
        "X-Powered-By": "XClaw-Gateway",
      });
      res.end();
      return true;
    }
    const body = JSON.stringify(out.jwks || out, null, 2);
    res.writeHead(200, {
      "Content-Type": "application/json; charset=utf-8",
      ETag: `"${etag}"`,
      "Cache-Control": "public, max-age=60, stale-while-revalidate=300",
      "X-XClaw-Key-Generation": String(out.generation ?? ""),
      "X-XClaw-Key-Kid": String(out.kid ?? ""),
      "X-Powered-By": "XClaw-Gateway",
    });
    res.end(body);
    return true;
  }

  if (p === "/xclaw/jwks/epoch" && method === "GET") {
    const { getInvalidationEpoch } = await import("../../auth/jwks-invalidation.mjs");
    json(res, 200, await getInvalidationEpoch(cfg));
    return true;
  }

  if (p === "/xclaw/jwks/invalidate" && method === "POST") {
    const { handleInvalidationHttp } = await import("../../auth/jwks-invalidation.mjs");
    const body = await readBody(req).catch(() => ({}));
    const r = await handleInvalidationHttp(cfg, "POST", body);
    // After publish, warm local cache
    try {
      const { refreshJwksAfterRotation } = await import("../../auth/jwks.mjs");
      await refreshJwksAfterRotation(cfg, body || {});
    } catch {
      /* optional */
    }
    json(res, r.status, r.body);
    return true;
  }

  if (p === "/xclaw/jwks/cache" && method === "GET") {
    const { getJwksCached } = await import("../../auth/jwks.mjs");
    const { getInvalidationEpoch } = await import("../../auth/jwks-invalidation.mjs");
    const cached = await getJwksCached(cfg);
    const epoch = await getInvalidationEpoch(cfg);
    json(res, 200, {
      etag: cached.etag,
      generation: cached.generation,
      kid: cached.kid,
      keyCount: cached.keyCount ?? cached.jwks?.keys?.length,
      dualWindowOpen: cached.dualWindowOpen,
      invalidationEpoch: epoch.epoch,
      exportedAt: cached.exportedAt,
    });
    return true;
  }

  return false;
}

export default { tryHandleJwksRoute };
