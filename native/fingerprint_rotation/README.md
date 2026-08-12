# xclaw-fingerprint-rotation (Rust)

Native implementation of XClaw fingerprint rotation with **dual-window** verify.

Parity with `src/auth/fingerprint-rotation.mjs`.

## Build / test

```bash
cd native/fingerprint_rotation
cargo test
cargo build --release
```

## API sketch

```rust
use xclaw_fingerprint_rotation::{
    FingerprintStore, RotateMode, SessionMaterial,
};

let store = FingerprintStore::new("/path/to/fingerprint-rotation.json")
    .with_dual_window_ms(3_600_000);

let mat = SessionMaterial::from_cookie("session=...");
store.ensure_binding(&mat)?;
store.verify(&mat)?;
store.rotate(Some(&mat), RotateMode::Both)?;
// dual window open — previous binding still valid
store.close_dual_window()?;
```

## Dual window

On `rotate`:

1. Snapshot `previous_salt`, `previous_binding`, `previous_generation`
2. Set `previous_valid_until = now + dual_window_ms`
3. Issue new salt and/or generation++
4. `verify` accepts **current** or **previous** until window ends

## Security

- State file written atomically, mode `0600` (Unix)
- `SessionMaterial` zeroized on drop
- Status types expose only shortened fingerprints
