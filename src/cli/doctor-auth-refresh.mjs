/**
 * Doctor shim for the ops.auth_refresh probe.
 *
 * `export { x } from "..."` re-exports without creating a local binding, so
 * naming it again in a default object throws at module load — and every caller
 * imports this dynamically inside a try/catch, which turned the crash into a
 * warn that read like a health result. Import first, then export both ways.
 */
import { pushAuthRefreshChecks } from "../tokens/auth-refresh-status.mjs";

export { pushAuthRefreshChecks };
export default { pushAuthRefreshChecks };
