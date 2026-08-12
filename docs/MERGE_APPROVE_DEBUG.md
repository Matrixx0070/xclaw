# Debugging `xclaw merge approve` failures

## Quick triage

```bash
xclaw merge list --status all
xclaw merge show <id>
xclaw merge doctor <id> --repo /path/to/main/repo
```

`doctor` is **read-only**: checks proposal state, main cleanliness, worktree existence, and `git apply --check`.

---

## Error codes

| Code | Meaning | Fix |
|------|---------|-----|
| `PROPOSAL_NOT_FOUND` | Id/prefix not in `merge-proposals/` | `merge list --status all`; wrong home/configDir |
| `PROPOSAL_STATE` | Not `pending` (applied/rejected/failed) | New swarm; or already done |
| `PROPOSAL_REJECTED` | Explicitly rejected | New proposal |
| **`REPO_MISSING`** | Candidate paths do not exist | `--repo /real/git/root` |
| **`REPO_NOT_DIRECTORY`** | Path is a file, not a directory | Point at directory |
| `MAIN_DIRTY` | `mergeRequireCleanMain` and dirty tree | `git stash -u` or commit |
| `MAIN_NOT_GIT` | Path exists but is not a git root | Pass correct `--repo` |
| `WORKTREE_GONE` | Implement worktree path deleted | Re-run implement; don't cleanup early |
| `MISSING_WORKTREE_PATH` | Proposal item incomplete | Swarm didn't record workspace |
| `PATCH_CHECK_FAILED` | `git apply --check` failed | Main drifted; inspect `patchPath` |
| `APPLY_FAILED` | Check passed, apply failed | Rare race; re-doctor |
| `INDEX_MISMATCH_RISK` | `useIndex` + dirty main | Clean main or disable index mode |

---

## Common scenarios

### 1. Wrong directory

```bash
# Fail: cwd is not the git root stored on the proposal
xclaw merge approve abc123

# Fix
xclaw merge show abc123   # read repoDir
xclaw merge approve abc123 --repo /correct/path
```

### 2. Worktree cleaned up

After swarm, something removed `/tmp/xclaw-wt-…`.

```text
code: WORKTREE_GONE
```

Re-run implement (or disable `cleanupWorktreeAfterMerge` until after approve).

### 3. Main moved on

Someone committed on main while the proposal was pending.

```bash
xclaw merge doctor abc --repo .
# PATCH_CHECK_FAILED + patchPath
git apply --check /tmp/xclaw-merge-….patch
```

Resolve by rebasing implement on new HEAD or manual patch edit.

### 4. Dirty main + S4

```bash
git status
git stash -u
xclaw merge approve abc --repo .
```

### 5. Prefix not unique

```text
Proposal not found
```

Use full UUID from `merge list` / `merge show`.

---

## Config dir mismatch

Proposals live under:

```text
{paths.configDir || ~/.xclaw}/swarms/merge-proposals/
```

If the gateway used a different config dir than the CLI, lists look empty. Align `XCLAW` config / `paths.configDir`.

---

## Soak

```bash
node scripts/soak-merge-cli.mjs
```

If soak PASS but real approve fails, compare `repoDir`, worktree path existence, and cleanliness.
