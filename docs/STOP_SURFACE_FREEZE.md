# Kill-switch surface freeze (n10)

Version marker: package.json `xclaw.stopSurfaceFreeze = "n10"`.

Contract:
- POST `/stop` with `dryRun: true` validates auth only
- OpenAPI requires `x-dry-run-response`
- Fire-drill must include `post_offline`
- Cost hard deny stamps quota circuit; history `costBlocked`
- Checkpoint/resume carries `quotaHardCircuit` + receipt collector
- Release evidence: `.xclaw-evidence/stopSurface.json` with `n10WiresApplied`

Verify:
```bash
node scripts/apply-n10-wires.mjs --check
node --test test/job-resume-collector.test.mjs test/checkpoint-circuit-roundtrip.test.mjs test/fire-drill-post-offline-guard.test.mjs test/openapi-dryrun-response.test.mjs
```
