/**
 * URL secret redaction (sweep #73, RULE(o)).
 *
 * Some providers put the API key IN the URL (Google Gemini
 * `/models?key=…`), and proxy URLs can carry `user:pass@` userinfo.
 * Any such URL that leaves the fetch call site — returned to doctor /
 * HTTP routes, persisted to a cache file, interpolated into logs — is
 * credential egress. The request itself keeps the real URL; everything
 * surfaced goes through here.
 */

const SECRET_PARAMS = /([?&](?:key|api_key|apikey|token|access_token|secret|client_secret)=)[^&#\s]*/gi;
const USERINFO = /^([a-z][a-z0-9+.-]*:\/\/)[^/@\s]+@/i;

export function redactUrlSecrets(url) {
  const s = String(url ?? "");
  return s.replace(SECRET_PARAMS, "$1<redacted>").replace(USERINFO, "$1<redacted>@");
}
