/**
 * Adapted from OpenClaw (MIT) — src/cron/session-target.ts
 * Session target helpers for cron / isolated runs.
 */
export const INVALID_SESSION_TARGET_ID_ERROR = "invalid session target id";

export function assertSafeSessionTargetId(sessionId) {
  const trimmed = String(sessionId || "").trim();
  if (!trimmed || trimmed.includes("\0")) {
    throw new Error(INVALID_SESSION_TARGET_ID_ERROR);
  }
  return trimmed;
}

export function resolveSessionTargetSessionKey(sessionTarget) {
  if (typeof sessionTarget !== "string" || !sessionTarget.startsWith("session:")) {
    return undefined;
  }
  return assertSafeSessionTargetId(sessionTarget.slice(8));
}

export function isDetachedSessionTarget(sessionTarget) {
  return sessionTarget === "isolated" || sessionTarget === "current";
}

export function resolveCurrentSessionTarget(params = {}) {
  if (params.sessionTarget !== "current") {
    return params.sessionTarget ?? undefined;
  }
  const sessionKey = params.sessionKey?.trim();
  return sessionKey ? "current" : "isolated";
}

export function resolveDeliverySessionKey(job = {}) {
  const fromTarget = resolveSessionTargetSessionKey(job.sessionTarget);
  if (fromTarget) return fromTarget;
  return typeof job.sessionKey === "string" && job.sessionKey.trim()
    ? job.sessionKey.trim()
    : undefined;
}

export function resolveNotificationSessionKey(params = {}) {
  return typeof params.sessionKey === "string" && params.sessionKey.trim()
    ? params.sessionKey.trim()
    : `cron:${params.jobId || "job"}:failure`;
}
