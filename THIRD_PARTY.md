# Third-party notices (SPDX)

XClaw itself is MIT — see [LICENSE](./LICENSE). This inventory covers **declared** npm packages and platform pieces operators actually run. It is not an Electron / Chromium license dump: this repo has no `electron`, `electron-builder`, or `electron-forge` dependency.

Generated against `package.json` optionalDependencies as shipped. Transitive licenses of those optionals are their upstream trees (werift / opusscript).

## Declared npm packages

| Package | Version (resolved) | SPDX | Role |
|---------|--------------------|------|------|
| `opusscript` | 0.0.8 | MIT | Optional voice Opus bindings (Emscripten libopus). Omit if unused. |
| `werift` | 0.22.9 (`^0.22.2`) | MIT | Optional WebRTC (voice). Omit if unused. |

There are **no** `dependencies` in `package.json`. Runtime is Node.js built-ins (`node:sqlite`, `node:test`, `node:child_process`, …).

## Platform / host (not npm)

| Component | SPDX / terms | Notes |
|-----------|----------------|-------|
| Node.js | MIT (project) + bundled third-party | Engines: `>=22.22.3 <23 \|\| >=24.15.0 <25 \|\| >=25.9.0`. Bundled `node:sqlite` must be WAL-safe (SQLite ≥ 3.51.3, or ≥ 3.50.7 on 3.50.x). |
| SQLite (via `node:sqlite`) | blessing (SQLite) | Control / memory / agent files under `~/.xclaw`. |
| bubblewrap | LGPL-2.0-or-later (typical distro package) | Host OS sandbox. `apt install bubblewrap`. Not vendored. See [docs/OS_SANDBOX.md](./docs/OS_SANDBOX.md). |
| sqlite-vec | **not shipped** | Opt-in native extension. No binary in `native/`. Load only when `memory.vec === true` via `$XCLAW_SQLITE_VEC` or `native/sqlite-vec`. |

## Intentionally absent

- No Tavily SDK.
- No Electron / Chromium packaging licenses.
- No WeChat / Feishu client SDKs.

Re-review this file when adding a runtime or optional dependency.
