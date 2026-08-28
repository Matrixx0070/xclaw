/**
 * Client errors the gateway is allowed to report as 4xx.
 *
 * Every gateway catch answered `500` for any throw, so a caller that sent a
 * malformed body was told the SERVER had failed. That is not cosmetic: this
 * repo's own HTTP client retries 500 by default
 * (`retryOnHttp = [408, 425, 429, 500, 502, 503, 504]` in utils/fetch-retry.mjs,
 * and `isRetryableStatus` in utils/backoff.mjs), so a request that can never
 * succeed — `{text:...}` where the route wants `{message:...}` — burns its whole
 * retry budget, and the 5xx rate that operators page on climbs for a caller-side
 * typo.
 *
 * The obvious fix, `json(res, err.status || 500)`, is WRONG here and would
 * introduce a worse bug than it closes. `err.status` already means something
 * else in this codebase: it carries the status of an OUTBOUND response, set in
 * ~19 places (agent/provider.mjs from `res.statusCode`, providers/
 * failover-router.mjs, channels/telegram/errors.mjs, utils/fetch-retry.mjs).
 * Two of those reach a gateway catch:
 *
 *   - failover-router.mjs sets `err.status = 401` for "No credentials for
 *     <model>" — a SERVER misconfiguration. Echoing 401 tells the caller their
 *     own token was rejected, sending them to re-authenticate a token that was
 *     never the problem.
 *   - provider.mjs copies the upstream provider's status (429, 503, ...) onto
 *     the error. Echoing it makes an upstream rate limit look like OUR rate
 *     limit, so the caller backs off against the wrong service.
 *
 * So a status may reach the wire only when THIS gateway's own input validation
 * set it. That cannot ride on the overloaded `err.status`; it needs a brand an
 * upstream error can never carry. The brand is a module-private Symbol, defined
 * (not `Symbol.for`) so it is unreachable from the global registry, and set
 * non-enumerable so it never survives `JSON.parse(JSON.stringify(err))` or a
 * structured clone — a client cannot forge one by sending `{status: 400}`.
 */

const CLIENT_ERROR = Symbol("xclaw.clientError");

/**
 * An error the CALLER can fix: malformed or missing input. Answered as 4xx.
 * @param {string} message human-readable, returned to the caller verbatim
 * @param {number} [status] 4xx, default 400
 */
export function clientError(message, status = 400) {
  if (!Number.isInteger(status) || status < 400 || status > 499) {
    throw new Error(`clientError status must be 4xx, got ${status}`);
  }
  const err = new Error(message);
  Object.defineProperty(err, CLIENT_ERROR, { value: status, enumerable: false });
  return err;
}

/** `clientError` with the default 400. */
export function badRequest(message) {
  return clientError(message, 400);
}

/**
 * The 4xx to answer with, or null to fall back to 500.
 *
 * Null for everything unbranded — including an upstream error carrying
 * `err.status = 401`, which is the whole point of the brand.
 * @returns {number|null}
 */
export function clientErrorStatus(err) {
  const status = err?.[CLIENT_ERROR];
  return Number.isInteger(status) && status >= 400 && status <= 499 ? status : null;
}
