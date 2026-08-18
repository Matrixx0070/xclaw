/**
 * Operator one-pager for kill-switch CLI.
 */
export const STOP_HELP = `
XClaw stop — single-port kill-switch

Usage:
  xclaw stop --help
  xclaw stop --sign [--body '{}'] [--print-curl] [--dry-run] [--json]
  xclaw stop-sign                 (alias)
  xclaw stop-all [--keep-computer]

Auth:
  Token:  Authorization: Bearer <token>  or  X-XClaw-Token
  HMAC:   X-XClaw-Stop-Sig = hex HMAC-SHA256(canonical body)
          secret: gateway.stopHmacSecret / XCLAW_STOP_HMAC_SECRET

Safe live probe (no sessions aborted):
  xclaw stop --sign --dry-run
  xclaw stop --sign --dry-run --print-curl

Fire-drill / doctor:
  node scripts/stop-fire-drill.mjs
  xclaw doctor --json     # summary.stop + ops.stop_fire_drill

See docs/STOP.md and docs/openapi-stop.yaml
`.trim();

export function printStopHelp(out = console.log) {
  out(STOP_HELP);
  return STOP_HELP;
}

export default { STOP_HELP, printStopHelp };
