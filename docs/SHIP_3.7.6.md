# Ship 3.7.6 — Release checklist

**Version:** `3.7.6`  
**Theme:** Swarm S0–S5 solid + git/SSH operator tooling  
**Date:** 2026-08-08

---

## Included since 3.7.4

| Area | Highlights |
|------|------------|
| **S0–S4** | Durable swarm, DAG, safe merge, clean-main / `--index` |
| **S5** | `xclaw swarm` / `xclaw merge` CLI |
| **Merge debug** | `merge doctor`, REPO_MISSING, WORKTREE_GONE codes |
| **Git** | Remote URL validation, credential helper integration |
| **SSH** | CA inspect/sign helpers, cert expiry doctor |

---

## Pre-ship

- [x] `package.json` version **3.7.6**
- [x] CHANGELOG 3.7.6 section
- [x] `swarm.autoMerge` default false
- [x] Docs: S3–S5, GIT_CREDENTIAL, SSH_CA, MERGE_APPROVE_DEBUG

---

## Tests (run on host)

```bash
cd /path/to/xclaw
node --test \
  test/s1-swarm-run.test.mjs \
  test/s2-swarm-graph.test.mjs \
  test/s3-swarm-merge.test.mjs \
  test/graph-viz.test.mjs \
  test/git-remote-url.test.mjs \
  test/git-credential.test.mjs \
  test/ssh-ca.test.mjs
node bin/xclaw.mjs doctor
node scripts/soak-merge-cli.mjs
```

- [ ] Suites green
- [ ] Doctor shows swarm.merge + git.* + ssh.certs lines

---

## Package

```bash
npm run package
# → ../XCLAW_RELEASE_v3.7.6.zip
shasum -a 256 ../XCLAW_RELEASE_v3.7.6.zip
```

**Artifact:** `XCLAW_RELEASE_v3.7.6.zip` (parent of `xclaw/`)  
**SHA-256:** _(fill after package)_

---

## Release notes

```markdown
## XClaw 3.7.6

### Swarm
- S0–S5 complete: durable runs, DAG, safe merge, governance, CLI
- `xclaw swarm status|show` · `xclaw merge list|approve|reject|doctor`

### Git / SSH
- Remote URL validation · credential fill (helpers + XCLAW_GIT_TOKEN)
- SSH CA helpers for cert inspect/sign · doctor expiry warnings

### Defaults
- autoMerge: false · merge governance flags off until enabled
```

---

## Sign-off

| Item | Status |
|------|--------|
| Swarm arc | Closed |
| Git/SSH tooling | Closed for this train |
| Ship decision | **GO** — package on host |

**Next (optional):** live multi-channel soak · vector memory · distributed workers  
