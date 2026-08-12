export function handle({ path, cfg }) {
  if (path === "/health") {
    // bug: requires token incorrectly
    if (!cfg.healthToken) return { status: 500, body: { ok: false } };
    return { status: 200, body: { ok: true } };
  }
  return { status: 404, body: { ok: false } };
}
