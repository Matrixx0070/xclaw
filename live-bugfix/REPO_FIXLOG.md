# REPO_FIXLOG — oauth policy + queue pause admission

## Failures
1. `test/oauth-policy.test.mjs` — expected Anthropic OAuth disabled; product has Claude PKCE.
2. `test/queue-retry.test.mjs` / `test/queue-stats.test.mjs` — `pauseQueue()` then `enqueueJob()` threw `QUEUE_PAUSED`.

## Fixes
1. **Test update** (`test/oauth-policy.test.mjs`): assert Anthropic `canStartOAuth` ok, `oauth.kind === "claude_pkce"`, recommended still `api_key`.
2. **Product fix** (`src/jobs/queue.mjs`): `enqueueJob` admission uses `paused: false` so pause only stops the worker from running jobs; enqueue still persists to disk.

## Verification
```
node --test test/oauth-policy.test.mjs test/queue-retry.test.mjs test/queue-stats.test.mjs
→ 7/7 pass
```
