/**
 * Per-request context (AsyncLocalStorage) for channel userId → vault.
 */
import { AsyncLocalStorage } from "node:async_hooks";

const als = new AsyncLocalStorage();

/**
 * @param {{ userId?: string, channel?: string, chatId?: string }} ctx
 * @param {() => Promise<T>} fn
 * @template T
 */
export function runWithRequestContext(ctx, fn) {
  return als.run({ ...(ctx || {}) }, fn);
}

export function getRequestContext() {
  return als.getStore() || {};
}

export function getRequestUserId() {
  const s = als.getStore() || {};
  return s.userId || s.user_id || null;
}
