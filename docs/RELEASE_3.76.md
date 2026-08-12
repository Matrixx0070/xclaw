# Release 3.76.0 checklist

## Verify
- [x] `node --test test/egress.test.mjs test/session-control.test.mjs test/session-kill-loop.test.mjs`
- [x] Live xAI: LIVE_OK + tool write/read + multi-step
- [x] CI eval-regression (unit + unit-media + live skip without secret)
- [x] `node bin/xclaw.mjs doctor` shows egress + killSwitch

## Ship
- [ ] Tag: `git tag -a v3.76.0 -m "3.76.0 security phase"`
- [ ] Rotate any API keys pasted in chat
- [ ] Optional: set GitHub secret `XAI_API_KEY` for live CI job
- [ ] Optional: `npm run release-gate:quick`

## Rollback
- Previous: 3.75.0 on main history
- Egress off: `XCLAW_EGRESS=allow` or profile lab
