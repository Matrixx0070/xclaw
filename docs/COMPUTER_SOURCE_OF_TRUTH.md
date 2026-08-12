# Computer source of truth (Phase A1)

**Status:** A1 complete — no separate pre-bundle TypeScript/JS tree exists in this repo.  
**Date:** 2026-08-10  

This document freezes where Chrome launch and CDP actuation actually live, so Phase A2+ can attach hooks to the right process without guessing.

---

## Verdict

| Question | Answer |
|----------|--------|
| Is there a pre-bundle source for the computer server? | **No** (not in this tree) |
| What is the runtime entry? | `src/computer/xclaw-server.mjs` |
| What kind of file is it? | **Bundled single-file runtime** (~16.8 MB), esbuild-style helpers at top (`__create`, `__defProp`, …), inlined deps (lodash, image quant, CDP protocol types, …) |
| Who owns Chrome launch? | `BrowserService.ensureRunning()` **inside** `xclaw-server.mjs` |
| Who owns CDP tab/navigate/JS? | Tool `xclaw_browser_tab` **inside** `xclaw-server.mjs` |
| Who starts the process? | `src/computer/manager.mjs` → `spawn(node, [entry])` |
| Default `entry`? | `src/config/defaults.mjs` → `computer.entry: "src/computer/xclaw-server.mjs"` |

**Implication for A2–A5:** Hook enforcement must either (1) run **inside the computer process** (import thin modules from the bundle’s runtime context / patch call sites), or (2) interpose on the **gateway tool router** before `computer.callTool`. There is no third “edit the original BrowserService.ts” path in-repo.

---

## Process topology

```text
bin/xclaw.mjs
  └─ computer start
       └─ src/computer/manager.mjs
            spawn(process.execPath, [cfg.computer.entry, ...])
                 │
                 ▼
            src/computer/xclaw-server.mjs   ← COMPUTER PROCESS (CDP owner)
                 │
                 ├─ BrowserService.ensureRunning()
                 │     • resolve chrome binary
                 │     • user-data-dir / profile lock
                 │     • argv (headless, remote-debugging, MITM flags, …)
                 │     • spawn Chromium
                 │     • wait CDP port
                 │
                 ├─ xclaw_browser_tab (and related tools)
                 │     • Target.createTarget
                 │     • Page.navigate
                 │     • Runtime.evaluate (jsCode)
                 │     • screenshots / network summaries
                 │
                 └─ HTTP API : computer.port (default 4243)

Gateway / agent process (separate)
  └─ src/tools/browser-tools.mjs  → computer.callTool(sessionId, "xclaw_browser_tab", …)
  └─ src/browser/*                → Horizon libs (mitm, sense, truth, physics, …)
  └─ mitmdump (sibling process)   → network interception
```

---

## Ownership map (Chrome + CDP)

| Concern | Owning artifact | Notes |
|---------|-----------------|-------|
| Process lifecycle (PID, health, logs) | `src/computer/manager.mjs` | Supervises computer; injects MITM env via `mitmEnvFromConfig` |
| Ensure/start convenience | `src/computer/ensure.mjs` | Retries start until `/health` |
| Auth proxy (optional) | `src/computer/auth-proxy.mjs` | In front of computer HTTP |
| **Chrome binary + spawn + args** | **`BrowserService` in `xclaw-server.mjs`** | ~line region `BrowserService` / `ensureRunning` |
| **Tab create / navigate / evaluate** | **`xclaw_browser_tab` in `xclaw-server.mjs`** | Primary actuation surface agents use |
| Network detail tool | `xclaw_browser_network_details` in bundle | Depends on tab capture flags |
| Horizon policy/sense/fabric | `src/browser/*.mjs` | **Gateway process** unless explicitly imported by computer |
| MITM proxy | `mitmdump` + `src/browser/mitm-confdir/addons.py` | Sibling process; not inside Chromium |

---

## Fingerprint: why this is a bundle, not hand source

1. Leading line injects `createRequire` / `__filename` / `__dirname` for CJS interop in ESM.  
2. Immediate `__create` / `__defProp` / `__exportAll`-style helpers (esbuild/bundler output).  
3. End of file contains third-party license blobs (lodash, image quantization, sax, …).  
4. No `src/computer/browser-service.mjs` (or similar) exists; only the blob + thin managers.  
5. OpenClaw/Hermes strings appear inside **bundled content**, not as an external checkout.

Horizon edits to launch flags (H0) were applied **by patching the blob** — consistent with “bundle is the source.”

---

## Config contract

```js
// src/config/defaults.mjs
computer: {
  entry: "src/computer/xclaw-server.mjs",  // overrideable
  port: 4243,
  host: "127.0.0.1",
  // remoteUrl: optional remote sidecar
}
```

Override `computer.entry` only if you ship a **replacement** server that still exposes the same tool/HTTP surface. Horizon must not assume a second in-tree BrowserService.

---

## Critical call sites for Phase A2 (hooks)

These are the **only** places that must gain fabric/motor hooks for fail-closed behavior:

| Hook | Call site (logical) | File |
|------|---------------------|------|
| `buildChromeArgs` / launch | `BrowserService.ensureRunning` args array | `xclaw-server.mjs` |
| `beforeNavigate` | `Page.navigate` inside `xclaw_browser_tab` | `xclaw-server.mjs` |
| `beforeInput` | Any `Input.dispatch*` / click paths if present | `xclaw-server.mjs` |
| `afterAction` | End of `xclaw_browser_tab` `call` success path | `xclaw-server.mjs` |
| Optional gateway belt | `executeLocalTool` / computer client before RPC | `src/agent/loop.mjs`, computer client |

**Gateway-only hooks are a belt.** Driver hooks inside the computer process are the **suspenders**. A2 should prefer computer-side import of a tiny `src/browser/hooks.mjs` (or duplicate-safe IPC) so non-tool CDP use cannot bypass policy.

---

## What A1 does *not* change

- Does not move Horizon modules into the blob.  
- Does not invent a fake “original source tree.”  
- Does not yet wire leases/gates/humanize (A2–A4).

---

## Follow-on (A2 entry)

1. Add `src/browser/hooks.mjs` — pure async hooks, no CDP.  
2. From computer process, dynamic-import hooks by absolute path relative to repo root or `XCLAW_ROOT`.  
3. Patch **one** navigate path first; prove fail-closed with `XCLAW_COMMIT_GATES=1`.  
4. Then humanize + chrome args single path (A4/A5).

Machine-readable companion: `src/computer/SOURCE_OF_TRUTH.json`.

---

## Amendment: Grok Computer Server lineage

Yes — **XClaw’s computer server is the same kind of thing as Grok’s.**

| Artifact | Path | Size |
|----------|------|------|
| Grok (host) | `/app/grok-computer-server.mjs` | ~16.82 MB |
| XClaw (repo) | `src/computer/xclaw-server.mjs` | ~16.83 MB |

### Same structure

- Both start with esbuild-style `createRequire` / `__defProp` helpers.
- Both define `BrowserService` at **line 382692**.
- Both define `ensureRunning` at **line 382745**.
- Both drive Chromium via CDP (`chrome-remote-interface` pattern documented in Grok browser-control notes).

### Differences (fork/rebrand surface)

| Grok | XClaw |
|------|--------|
| Tool `browser_tab` | Tool `xclaw_browser_tab` |
| Tool `browser_network_details` | Tool `xclaw_browser_network_details` |
| Stock ensureRunning (tmp profile, basic flags) | H0/B0 patches: durable profile, lock, `remote-allow-origins`, `headless=new`, MITM CA import, etc. |
| Entry often `/app/grok-computer-server.mjs` | Entry `src/computer/xclaw-server.mjs` via `computer.entry` |

### Still no unbundled source

- `/app` contains **only** the Grok shipping bundle, not a `src/browser/BrowserService.ts` tree.
- `XCLAW_COMPUTER_SERVER.zip` contains the **same** bundled `xclaw-server.mjs`, not original sources.
- Grok docs (`GROK_COMPUTER_BROWSER_CONTROL.md`, etc.) describe behavior extracted from that bundle; they are **documentation**, not compilable multi-file source.

**A1 conclusion stands, with lineage clarified:** the real computer source available to us **is the Grok/XClaw server bundle**. Phase A2 must hook that file (or interpose outside it)—there is no cleaner upstream tree on this host.
