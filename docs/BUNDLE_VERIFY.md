# CDP bundle verification (online & offline)

The full-CDP runtime is `src/computer/xclaw-server.mjs` (~16.8MB). It is **not** git-tracked. Trust is pinned by `src/computer/bundle-artifact.json`.

## Offline content integrity (always works)

No network required. Compares on-disk bytes to the committed manifest.

```bash
# Recommended
npm run verify:bundle

# Equivalent
node scripts/verify-computer-bundle.mjs
```

Manual:

```bash
sha256sum src/computer/xclaw-server.mjs
# must equal "sha256" in src/computer/bundle-artifact.json

wc -c src/computer/xclaw-server.mjs
# must equal "bytes" in the manifest
```

| Exit | Meaning |
|------|---------|
| 0 | Hash + size match |
| 2 | File missing or hash/size mismatch |

This is **content-addressed integrity**, not a publisher signature.

## Install then verify

```bash
npm run fetch:bundle    # download/copy + sha256 gate
npm run verify:bundle   # re-check offline (no re-download)
```

## Optional Sigstore / Cosign (signature)

XClaw does **not** ship a `.sigstore.json` yet. When a publish workflow adds one:

| File | Role |
|------|------|
| `xclaw-server.mjs` | Artifact |
| `xclaw-server.mjs.sigstore.json` | Cosign bundle (sig + cert + log proof) |
| `bundle-artifact.json` → `sigstore` | Optional identity pins |

### Online signature verify

Needs `cosign` and usually network for public-good trust roots (unless cached):

```bash
npm run verify:bundle -- --require-sigstore
```

### Offline signature verify

1. Obtain Sigstore **trusted root** once (on a networked machine), e.g. Cosign/TUF material documented for your Cosign version.
2. Copy root into the air-gap environment.
3. Ensure `.sigstore.json` sits next to the blob (or path in manifest).
4. Run:

```bash
node scripts/verify-computer-bundle.mjs \
  --require-sigstore \
  --trusted-root /path/to/trusted_root.json
```

Or:

```bash
export XCLAW_SIGSTORE_TRUSTED_ROOT=/path/to/trusted_root.json
npm run verify:bundle -- --require-sigstore
```

Without `--trusted-root`, Cosign may still try to refresh trust material from the network.

### Manual Cosign

```bash
cosign verify-blob src/computer/xclaw-server.mjs \
  --bundle src/computer/xclaw-server.mjs.sigstore.json \
  --certificate-identity-regexp \
    '^https://github.com/Matrixx0070/xclaw/\.github/workflows/.*' \
  --certificate-oidc-issuer https://token.actions.githubusercontent.com \
  --trusted-root /path/to/trusted_root.json   # offline
```

## Policy levels

| Mode | Command | Trust |
|------|---------|--------|
| Hash-only (default) | `npm run verify:bundle` | Manifest authors + git |
| Sigstore required | `… --require-sigstore` | + CI workflow identity |
| Air-gap hash | same as hash-only | No network |
| Air-gap signed | `--require-sigstore --trusted-root …` | Pre-provisioned root + bundle |

## Related

- `npm run fetch:bundle` — install with sha256 gate  
- `npm run check:computer-parity` — presence only (not crypto)  
- `npm run c4:soak` — engine entry existence  
- Strategy C: do not hand-edit the 16MB blob
