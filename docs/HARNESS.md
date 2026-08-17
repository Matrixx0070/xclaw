# Long-running harness (anti-hallucination)

`xclaw harness` runs a **verified long job** with hard grounding defaults so the agent cannot claim success without tool evidence.

## Quick start

```bash
export XAI_API_KEY=...
export XCLAW_PROFILE=lab

xclaw harness "Create notes/hello.txt containing HELLO_XCLAW. Re-read it to confirm." \
  --exists notes/hello.txt \
  --contains notes/hello.txt:HELLO_XCLAW \
  --max-turns 12
```

Exit code **0** only if verify checks pass **and** claims are grounded.

## Defaults

| Flag | Default |
|------|---------|
| `groundHard` | `true` — ungrounded claims → job fail |
| `claimsRequireEvidence` | `true` |
| `requireStructuredClaims` | `true` |
| `maxTurns` | `24` |
| `timeoutMs` | `300000` |
| `groundingRetry` | `1` corrective re-run on grounding fail |
| `persistRun` | snapshot under `~/.xclaw/agent-runs/` |
| `checkpointEveryTurns` | `3` — mid-run checkpoint to `~/.xclaw/checkpoints/` |

## What “without hallucination” means here

1. **System notes** force verify-by-tool and forbid inventing paths/contents.
2. **Evidence log** records every tool end + verify result.
3. **Claim scorer** requires structured `claims` + `evidence_ids` that match real tool evidence.
4. **Verify checks** (`file_exists`, `file_contains`, `command`, …) are the objective pass criteria.
5. **Grounding retry** once with a critique listing failed warnings.

This does **not** make the model incapable of false thoughts mid-turn; it makes the **job fail closed** when final claims are not backed by tools/verify.

## API

```js
import { runLongHarness } from "./src/jobs/long-harness.mjs";

const job = await runLongHarness({
  goal: "...",
  cfg,
  verify: [
    { type: "file_contains", path: "out.txt", text: "OK" },
    { type: "command", cmd: "node test/run.mjs", exitCode: 0 },
  ],
});
// job.pass, job.groundingFailed, job.claimScore, job.verify
```

## Config

```json
{
  "harness": {
    "groundHard": true,
    "maxTurns": 32,
    "timeoutMs": 600000,
    "groundingRetry": 1
  }
}
```


## Mid-run checkpoints

Every N agent turns (default **3**), the job writes:

`~/.xclaw/checkpoints/<jobId>.json`

with `status: "running"`, `midRun: true`, recent `toolTrace` / `evidence`.

```bash
xclaw resume <jobId>          # existing recovery path
# or
ls ~/.xclaw/checkpoints/
```

Events: `{ type: "job", phase: "checkpoint", turn, path }`.

Config: `harness.checkpointEveryTurns` or `jobs.checkpointEveryTurns` (set `0` to disable).


## Recovery strategies

`resumeJobFromCheckpoint` / `xclaw resume <id>` classifies the failure and injects a tailored recovery prompt:

| Kind | When | Strategy |
|------|------|----------|
| `transport` | ECONNREFUSED / computer down | Inspect workspace, finish missing steps |
| `budget` | turns/time/cost | Minimal remaining work + slight turn boost |
| `security` | deny / approval | Allowlisted tools only; no invented success |
| `grounding` | claim/evidence fail | Hard ground + structured claims; may use harness |
| `verify` | objective checks fail | Fix only failures; re-run checks |
| `interrupted` | mid-run snapshot, no error | Continue from turn N without redo |

Override: `resumeJobFromCheckpoint(cfg, id, { strategy: "grounding" })`.


## Live smoke (API key required)

```bash
# Never paste keys into chat — env only
export XAI_API_KEY=...
export XCLAW_PROFILE=lab

# Optional overrides
# export HARNESS_WORKSPACE=/tmp/xclaw-live
# export HARNESS_MAX_TURNS=12
# export HARNESS_TIMEOUT_MS=180000

npm run harness:live
# or
node scripts/live-harness-smoke.mjs
```

What it does:

1. Checks for `XAI_API_KEY` / Anthropic / OpenAI  
2. `ensureComputer` (starts computer server if needed)  
3. `runLongHarness` with verify: create `notes/live_harness.txt` + marker string  
4. Prints JSON summary; exit 0 only if verify + grounding pass  

Manual equivalent:

```bash
xclaw harness "Create notes/hello.txt with HELLO. Re-read to confirm." \
  --exists notes/hello.txt \
  --contains notes/hello.txt:HELLO \
  --max-turns 12
```


## Checkpoint eviction

```bash
xclaw resume prune
xclaw resume prune --dry-run
```

Defaults: keep **100** newest terminal CPs, drop older than **14 days**, never delete `running`/`resuming`.

```json
{ "checkpoints": { "maxCount": 100, "maxAgeMs": 1209600000, "pruneOnTick": true } }
```

`xclaw evolve tick` prunes unless `checkpoints.pruneOnTick` is false.
