/**
 * Seat OAuth refresh rotation + reuse detection (scaffold).
 */
const seenRefreshTokens = new Map();

export function hashToken(token) {
  if (!token) return null;
  let h = 0;
  const s = String(token);
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
  return h.toString(16);
}

export function recordRefreshUse(token, { rotatedFrom = null } = {}) {
  const id = hashToken(token);
  if (!id) return { ok: false, reason: "empty_token" };
  if (seenRefreshTokens.has(id)) {
    return { ok: false, reused: true, reason: "refresh_token_reuse" };
  }
  seenRefreshTokens.set(id, { at: Date.now(), rotatedFrom: hashToken(rotatedFrom) });
  if (rotatedFrom) {
    const old = hashToken(rotatedFrom);
    if (old) seenRefreshTokens.set(old, { at: Date.now(), retired: true });
  }
  return { ok: true, reused: false, id };
}

export function clearRefreshRegistry() {
  seenRefreshTokens.clear();
}

export default { hashToken, recordRefreshUse, clearRefreshRegistry };
