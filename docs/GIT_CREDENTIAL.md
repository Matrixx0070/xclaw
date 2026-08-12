# Git credential helper integration

XClaw talks to Git’s standard credential protocol via `git credential fill|approve|reject`.

## Module

`src/git/credential.mjs`

| API | Role |
|-----|------|
| `fillGitCredential(url\|attrs)` | Resolve username/password |
| `approveGitCredential(...)` | Store after success |
| `rejectGitCredential(...)` | Erase after auth failure |
| `credentialDescriptionFromUrl` | Map remote URL → attrs |
| `gitCredentialHelperStatus` | Doctor: is helper configured? |

## Headless / agent env

If helpers cannot prompt:

```bash
export XCLAW_GIT_USERNAME=x-access-token   # or git user
export XCLAW_GIT_TOKEN=ghp_...             # or GITHUB_TOKEN / GH_TOKEN / GITLAB_TOKEN
# or
export XCLAW_GIT_PASSWORD=...
```

`fillGitCredential` merges env when `useEnv` is true (default).

## Host setup

```bash
# cache in memory (timeout seconds)
git config --global credential.helper 'cache --timeout=28800'

# or macOS keychain / libsecret / manager-core on Windows
git config --global credential.helper osxkeychain
```

## Doctor

```bash
xclaw doctor
# git.credential  ok|warn  helpers: ...
```

## Security

- Never log `password` — use `redactCredentialAttrs`
- Prefer helpers / env over embedding secrets in remote URLs
- `embedHttpsCredentials` exists for rare cases; avoid persisting those URLs
