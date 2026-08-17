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
