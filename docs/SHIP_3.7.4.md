# Ship 3.7.4 — Release checklist

**Version:** `3.7.4`  
**Theme:** Close swarm arc S0–S4 (durable → fan-out → DAG → safe merge → governance)  
**Date:** 2026-08-08

---

## 0. Pre-ship (code freeze)

- [x] `package.json` → `"version": "3.7.4"`
- [x] `CHANGELOG.md` has **3.7.4** (S4) and **3.7.3** (S3)
- [x] No secrets committed in tree (tokens only via env)
- [x] `swarm.autoMerge` default **`false`**
- [x] `mergeRequireCleanMain` / `mergeUseIndex` default **`false`**
- [x] Docs:
  - [x] `docs/S1_SWARM_FANOUT.md`
  - [x] `docs/S2_TASK_GRAPH.md`
  - [x] `docs/S3_SAFE_MERGE.md`
  - [x] `docs/S4_MERGE_GOVERNANCE.md`
  - [x] `docs/SHIP_3.7.4.md`

---

## 1. Automated tests

```bash
node --test test/s1-swarm-run.test.mjs test/s2-swarm-graph.test.mjs test/s3-swarm-merge.test.mjs test/graph-viz.test.mjs
# full:
npm test
```

| Suite | Expect |
|-------|--------|
| S1 validation + mock fan-out | PASS |
| S2 graph / backoff | PASS |
| S3/S4 merge policy | PASS |
| Graph viz | PASS |

- [ ] Core swarm suites green
- [ ] `npm run self-check` acceptable

---

## 2. Doctor smoke

```bash
node bin/xclaw.mjs doctor
```

- [ ] Completes
- [ ] `swarm.merge` line present (autoMerge / requireVerify / requireCleanMain / useIndex)
- [ ] Pending proposals count

---

## 3. Feature proof (S0–S4)

### S0–S2
- [ ] Durable agents/runs under `~/.xclaw/swarms/`
- [ ] Flat fan-out + join summary
- [ ] DAG `dependsOn`, waves, skip-downstream
- [ ] Structured errors + retries

### S3
- [ ] `--check` before apply
- [ ] Default pending_approval
- [ ] approve / reject tools

### S4
- [ ] `mergeRequireCleanMain` blocks dirty main (`MAIN_DIRTY`)
- [ ] `mergeUseIndex` uses `--index` path
- [ ] Doctor surfaces policy

### S1 tests
- [ ] Mock `spawnSubagent` runtime tests in `test/s1-swarm-run.test.mjs`

---

## 4. Package

```bash
npm run package
# → ../XCLAW_RELEASE_v3.7.4.zip
shasum -a 256 ../XCLAW_RELEASE_v3.7.4.zip
```

- [ ] Zip written
- [ ] SHA-256 recorded below

**Artifact path (from `npm run package`):**  
`/home/workdir/artifacts/XCLAW_RELEASE_v3.7.4.zip`  
(parent of `xclaw/` tree)

**SHA-256:** run `shasum -a 256 ../XCLAW_RELEASE_v3.7.4.zip` after package  

**Note:** If sandbox shell is unavailable, package from host:
```bash
cd /home/workdir/artifacts/xclaw && npm run package
```

---

## 5. Release notes (copy-paste)

```markdown
## XClaw 3.7.4 — Swarm arc complete (S0–S4)

### Highlights
- **S4 Merge governance:** clean-main gate, optional `git apply --index`
- **S3 Safe merge:** check → pending approval → owner approve
- **S2 Task graphs:** dependsOn, waves, upstream handoff, retries
- **S1 Fan-out:** parallel subagents + join summary (mock-tested)
- **S0:** durable swarm/agent registry

### Defaults (safe)
- autoMerge: false
- mergeRequireCleanMain: false (enable in prod)
- mergeUseIndex: false

### Docs
- S3_SAFE_MERGE, S4_MERGE_GOVERNANCE, SHIP_3.7.4
```

---

## 6. Sign-off

| Role | Status |
|------|--------|
| Builder | GO — swarm arc closed |
| Ship decision | [x] GO for package |

**Next after ship:** live soak optional · S5 CLI · vector memory (parked)
