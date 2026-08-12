# Ship 3.7.8 — Release checklist

**Version:** `3.7.8`  
**Theme:** Structured majority vote + tie-break · swarm S0–S5 · git/SSH tooling  
**Date:** 2026-08-08

---

## Scope

| Area | Notes |
|------|--------|
| S0–S5 | Durable swarm, DAG, merge, governance, CLI |
| Vote | JSON ballots, majority, tie-break (default confidence) |
| Soak | `scripts/soak-vote.mjs`, `scripts/soak-merge-cli.mjs` |
| Git/SSH | Remote validation, credentials, SSH CA helpers |

---

## Pre-ship

- [x] `package.json` → `3.7.8`
- [x] CHANGELOG 3.7.7 + 3.7.8
- [x] `swarm.autoMerge` default false
- [x] `voteTieBreak` default `confidence`

---

## Tests (host)

```bash
cd /path/to/xclaw

node --test \
  test/s1-swarm-run.test.mjs \
  test/s2-swarm-graph.test.mjs \
  test/s3-swarm-merge.test.mjs \
  test/graph-viz.test.mjs \
  test/swarm-vote.test.mjs \
  test/git-remote-url.test.mjs \
  test/git-credential.test.mjs \
  test/ssh-ca.test.mjs

node scripts/soak-vote.mjs
node scripts/soak-merge-cli.mjs

node bin/xclaw.mjs doctor
```

- [ ] Unit suites green
- [ ] Vote soak all PASS
- [ ] Merge soak PASS (optional if git available)
- [ ] Doctor completes

---

## Package

```bash
npm run package
# → ../XCLAW_RELEASE_v3.7.8.zip
shasum -a 256 ../XCLAW_RELEASE_v3.7.8.zip
```

**Artifact:** `XCLAW_RELEASE_v3.7.8.zip`  
**SHA-256:** _(fill after package)_  
**Size:** _(fill)_

---

## Release notes

```markdown
## XClaw 3.7.8

### Swarm
- S0–S5: durable runs, DAG, safe merge, CLI
- Structured majority vote on research JSON ballots
- Tie-break: confidence (default), first, lexical, prefer, …

### Git / SSH
- Remote URL validation · credential helpers · SSH CA helpers

### Ops
- xclaw swarm / merge CLI · merge doctor · vote + merge soak scripts

### Safe defaults
- autoMerge: false
- voteEnabled: true, voteTieBreak: confidence
```

---

## Sign-off

| Item | Status |
|------|--------|
| Feature freeze | GO |
| Ship decision | GO — package on host |

**Next after ship:** optional L3 live vote swarm · vector memory · multi-host workers  
