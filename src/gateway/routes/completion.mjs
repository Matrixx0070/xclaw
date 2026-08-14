/**
 * Code-completion route — repo-aware fill-in-the-middle.
 *
 *   POST /complete {prefix, suffix?, file?, repoDir?, language?} → {completion,…}
 *
 * Token-gated in BOTH auth modes: every call spends provider tokens.
 */
export async function tryHandleCompletionRoute({ p, method, res, cfg, json, readBody, req }) {
  if (p !== "/complete") return false;
  if (method !== "POST") {
    json(res, 405, { ok: false, error: "POST {prefix, suffix?, file?, repoDir?}" });
    return true;
  }
  const body = await readBody(req).catch(() => ({}));
  if (!String(body.prefix || "").trim()) {
    json(res, 400, { ok: false, error: "prefix required" });
    return true;
  }
  try {
    const { completeCode } = await import("../../completion/service.mjs");
    const out = await completeCode(cfg, {
      prefix: body.prefix,
      suffix: body.suffix,
      file: body.file,
      repoDir: body.repoDir,
      language: body.language,
    });
    json(res, 200, { ok: true, ...out });
  } catch (e) {
    json(res, 502, { ok: false, error: e.message });
  }
  return true;
}
