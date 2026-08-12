# XClaw author signature on GitHub

Whenever XClaw commits code (merge approve or agent `git commit` in a hooked repo), the commit message includes:

```text
Generated with [XClaw](https://x.ai/)
Co-Authored-By: XClaw <noreply@xclaw.local>
```

Same idea as Claude Code / Happy trailers.

## Automatic paths

| Path | Behavior |
|------|----------|
| **Merge approve** | Default **`commitAfterMerge: true`** → `git add -A` + commit with trailers |
| **prepare-commit-msg hook** | Installed on worktree/repo so agent `git commit` also gets trailers |
| **Push** | No special trailer; trailers ride on the commit object |

## Disable (not recommended)

```json
{
  "swarm": { "commitAfterMerge": false },
  "git": {
    "alwaysTrailers": false,
    "installCommitHook": false
  }
}
```

CLI one-off without commit: `xclaw merge approve <id> --repo …` with config `commitAfterMerge: false`, or pass internal `noCommit` from tools.

## Customize

```json
{
  "git": {
    "commitGeneratedWith": "Generated with [XClaw](https://x.ai/)",
    "commitCoAuthoredBy": "Co-Authored-By: XClaw <noreply@xclaw.local>"
  }
}
```
