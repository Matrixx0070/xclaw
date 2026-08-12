# Fingerprint rotation in Rust

Native crate: `native/fingerprint_rotation/`

| JS | Rust |
|----|------|
| `bindingFingerprint` | `binding_fingerprint` |
| `rotateFingerprint` | `FingerprintStore::rotate` |
| `verifyFingerprint` | `FingerprintStore::verify` |
| dual window | `previous_valid_until` + `VerifyOk::Previous` |
| `closeDualWindow` | `close_dual_window` |

```bash
cd native/fingerprint_rotation && cargo test
```

See crate `README.md` for API details.
