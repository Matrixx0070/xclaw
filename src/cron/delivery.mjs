/**
 * Adapted from OpenClaw (MIT) — delivery-context / delivery-defaults patterns
 */
import { parseSessionKey } from "../sessions/session-key.mjs";
import {
  resolveDeliverySessionKey,
  resolveNotificationSessionKey,
  isDetachedSessionTarget,
} from "../sessions/session-target.mjs";

export function normalizeDeliveryContext(ctx = {}) {
  if (!ctx || typeof ctx !== "object") return undefined;
  const to = ctx.to || ctx.peerId || ctx.recipient;
  if (!to) return undefined;
  return {
    channel: ctx.channel,
    to: String(to),
    accountId: ctx.accountId,
    threadId: ctx.threadId,
  };
}

export function cronDeliveryFromContext(context) {
  const normalized = normalizeDeliveryContext(context);
  if (!normalized?.to) return null;
  const delivery = { mode: "announce", to: normalized.to };
  if (normalized.channel) delivery.channel = normalized.channel;
  if (normalized.accountId) delivery.accountId = normalized.accountId;
  if (normalized.threadId != null) delivery.threadId = normalized.threadId;
  return delivery;
}

export function resolveDeliveryFromSessionKey(sessionKey) {
  const parsed = parseSessionKey(sessionKey);
  if (!parsed?.peerId) return undefined;
  return {
    channel: parsed.channel,
    to: parsed.peerId,
    threadId: parsed.threadId,
  };
}

export function resolveCronCreationDelivery(params = {}) {
  return (
    cronDeliveryFromContext(params.currentDeliveryContext) ||
    cronDeliveryFromContext(resolveDeliveryFromSessionKey(params.agentSessionKey))
  );
}

export function shouldDefaultCronDeliveryToAnnounce(params = {}) {
  if (params.payloadKind === "systemEvent") return false;
  if (isDetachedSessionTarget(params.sessionTarget)) return true;
  return Boolean(params.delivery?.to || params.sessionKey);
}

export function resolveJobDeliverySessionKey(job = {}) {
  return (
    resolveDeliverySessionKey(job) ||
    job.delivery?.sessionKey ||
    undefined
  );
}

export function resolveJobNotificationKey(job = {}) {
  return resolveNotificationSessionKey({
    jobId: job.id,
    sessionKey: resolveJobDeliverySessionKey(job),
  });
}
