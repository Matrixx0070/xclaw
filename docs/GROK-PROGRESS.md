# GROK-PROGRESS

## 2026-08-12 — bwrap OS sandbox

STATUS: green

- `src/security/os-sandbox.mjs` — detect bwrap, build binds, unshare-net/pid
- bash-tool wraps spawn via wrapSpawnWithOsSandbox
- doctor: security.osSandbox
- tests skip live bwrap when binary missing (this host)

Install bubblewrap on runners/hosts for full isolation.
