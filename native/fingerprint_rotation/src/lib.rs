//! XClaw fingerprint rotation (Rust).
//!
//! Mirrors `src/auth/fingerprint-rotation.mjs`:
//! - material fingerprint = SHA-256 of cookie/token material
//! - binding fingerprint  = SHA-256(material ‖ generation ‖ salt)
//! - dual window accepts previous binding until `previous_valid_until`
//!
//! Secrets are never included in Display/Debug of status types.

use rand::RngCore;
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::fs;
use std::io::{self, Write};
use std::path::{Path, PathBuf};
use std::time::{SystemTime, UNIX_EPOCH};
use thiserror::Error;
use zeroize::Zeroize;

const FP_PREFIX: &str = "xclaw-fp-v1";
const DEFAULT_DUAL_WINDOW_MS: u64 = 3_600_000; // 1 hour
const HISTORY_CAP: usize = 20;

#[derive(Debug, Error)]
pub enum FpError {
    #[error("io: {0}")]
    Io(#[from] io::Error),
    #[error("json: {0}")]
    Json(#[from] serde_json::Error),
    #[error("no session material")]
    NoMaterial,
    #[error("binding mismatch")]
    BindingMismatch,
    #[error("material changed without rebind")]
    MaterialChanged,
    #[error("dual window closed")]
    DualWindowClosed,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum RotateMode {
    Salt,
    Generation,
    Both,
}

impl Default for RotateMode {
    fn default() -> Self {
        RotateMode::Both
    }
}

/// Session material used only to compute digests (zeroized on drop if desired).
#[derive(Clone, Zeroize)]
#[zeroize(drop)]
pub struct SessionMaterial {
    pub cookie: Option<String>,
    pub authorization: Option<String>,
}

impl SessionMaterial {
    pub fn from_cookie(cookie: impl Into<String>) -> Self {
        Self {
            cookie: Some(cookie.into()),
            authorization: None,
        }
    }

    pub fn is_empty(&self) -> bool {
        self.cookie.as_ref().map(|s| s.is_empty()).unwrap_or(true)
            && self
                .authorization
                .as_ref()
                .map(|s| s.is_empty())
                .unwrap_or(true)
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct HistoryEntry {
    pub at: u64,
    pub mode: String,
    pub generation: u64,
    pub previous_generation: u64,
    pub dual_window_ms: u64,
    /// truncated binding prefix only
    pub binding_prefix: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct FingerprintState {
    pub version: u32,
    pub salt: Option<String>,
    pub previous_salt: Option<String>,
    pub generation: u64,
    pub previous_generation: Option<u64>,
    pub binding: Option<String>,
    pub previous_binding: Option<String>,
    pub material: Option<String>,
    pub previous_material: Option<String>,
    pub rotated_at: Option<u64>,
    pub previous_valid_until: Option<u64>,
    pub bound_at: Option<u64>,
    pub history: Vec<HistoryEntry>,
}

#[derive(Debug, Clone, Serialize)]
pub struct DualWindowStatus {
    pub open: bool,
    pub remaining_ms: u64,
    pub previous_valid_until: Option<u64>,
    pub previous_generation: Option<u64>,
    pub previous_binding_short: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
pub struct FingerprintStatus {
    pub generation: u64,
    pub has_salt: bool,
    pub binding_short: Option<String>,
    pub material_short: Option<String>,
    pub rotated_at: Option<u64>,
    pub dual_window: DualWindowStatus,
}

#[derive(Debug, Clone, Serialize)]
#[serde(tag = "match", rename_all = "snake_case")]
pub enum VerifyOk {
    Current {
        generation: u64,
        binding_short: String,
    },
    Previous {
        generation: u64,
        binding_short: String,
        previous_valid_until: u64,
        dual_window_remaining_ms: u64,
    },
}

#[derive(Debug, Clone, Serialize)]
pub struct RotateResult {
    pub mode: String,
    pub generation: u64,
    pub previous_generation: u64,
    pub binding_short: Option<String>,
    pub previous_binding_short: Option<String>,
    pub previous_valid_until: u64,
    pub dual_window_ms: u64,
    pub dual_window_open: bool,
}

fn now_ms() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0)
}

fn short_fp(fp: &str) -> String {
    if fp.len() <= 8 {
        return "***".into();
    }
    format!("{}…{} (len={})", &fp[..4], &fp[fp.len() - 4..], fp.len())
}

/// SHA-256 hex of cookie/authorization material.
pub fn material_fingerprint(material: &SessionMaterial) -> Option<String> {
    if material.is_empty() {
        return None;
    }
    let mut hasher = Sha256::new();
    if let Some(ref c) = material.cookie {
        hasher.update(c.as_bytes());
    }
    hasher.update(b"|");
    if let Some(ref a) = material.authorization {
        hasher.update(a.as_bytes());
    }
    Some(hex::encode(hasher.finalize()))
}

/// Binding = SHA-256("xclaw-fp-v1" ‖ material ‖ generation ‖ salt)
pub fn binding_fingerprint(material_fp: &str, generation: u64, salt: &str) -> String {
    let mut hasher = Sha256::new();
    hasher.update(FP_PREFIX.as_bytes());
    hasher.update(b"|");
    hasher.update(material_fp.as_bytes());
    hasher.update(b"|");
    hasher.update(generation.to_string().as_bytes());
    hasher.update(b"|");
    hasher.update(salt.as_bytes());
    hex::encode(hasher.finalize())
}

pub fn new_salt(bytes: usize) -> String {
    let mut buf = vec![0u8; bytes];
    rand::thread_rng().fill_bytes(&mut buf);
    let s = hex::encode(&buf);
    buf.zeroize();
    s
}

pub fn dual_window_open(state: &FingerprintState, now: u64) -> bool {
    matches!(
        (
            state.previous_salt.as_ref(),
            state.previous_binding.as_ref(),
            state.previous_valid_until
        ),
        (Some(_), Some(_), Some(until)) if now <= until
    )
}

pub fn dual_window_remaining_ms(state: &FingerprintState, now: u64) -> u64 {
    if !dual_window_open(state, now) {
        return 0;
    }
    state
        .previous_valid_until
        .map(|u| u.saturating_sub(now))
        .unwrap_or(0)
}

fn atomic_write(path: &Path, body: &[u8]) -> Result<(), FpError> {
    if let Some(dir) = path.parent() {
        fs::create_dir_all(dir)?;
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            let _ = fs::set_permissions(dir, fs::Permissions::from_mode(0o700));
        }
    }
    let tmp = path.with_extension(format!("tmp.{}", std::process::id()));
    {
        let mut f = fs::File::create(&tmp)?;
        f.write_all(body)?;
        f.sync_all()?;
    }
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        let _ = fs::set_permissions(&tmp, fs::Permissions::from_mode(0o600));
    }
    fs::rename(&tmp, path)?;
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        let _ = fs::set_permissions(path, fs::Permissions::from_mode(0o600));
    }
    Ok(())
}

pub struct FingerprintStore {
    path: PathBuf,
    dual_window_ms: u64,
}

impl FingerprintStore {
    pub fn new(path: impl Into<PathBuf>) -> Self {
        Self {
            path: path.into(),
            dual_window_ms: DEFAULT_DUAL_WINDOW_MS,
        }
    }

    pub fn with_dual_window_ms(mut self, ms: u64) -> Self {
        self.dual_window_ms = ms;
        self
    }

    pub fn path(&self) -> &Path {
        &self.path
    }

    pub fn load(&self) -> Result<FingerprintState, FpError> {
        match fs::read_to_string(&self.path) {
            Ok(s) => Ok(serde_json::from_str(&s)?),
            Err(e) if e.kind() == io::ErrorKind::NotFound => Ok(FingerprintState {
                version: 1,
                ..Default::default()
            }),
            Err(e) => Err(e.into()),
        }
    }

    pub fn save(&self, state: &FingerprintState) -> Result<(), FpError> {
        let body = serde_json::to_vec_pretty(state)?;
        atomic_write(&self.path, &body)
    }

    /// Bind current material under existing or new salt.
    pub fn ensure_binding(&self, material: &SessionMaterial) -> Result<FingerprintStatus, FpError> {
        let mat = material_fingerprint(material).ok_or(FpError::NoMaterial)?;
        let mut state = self.load()?;
        if state.salt.is_none() {
            state.salt = Some(new_salt(32));
        }
        let salt = state.salt.as_ref().unwrap().clone();
        let binding = binding_fingerprint(&mat, state.generation, &salt);
        state.binding = Some(binding);
        state.material = Some(mat);
        state.bound_at = Some(now_ms());
        self.save(&state)?;
        Ok(self.status_from(&state))
    }

    /// Rotate salt and/or generation; open dual window on previous binding.
    pub fn rotate(
        &self,
        material: Option<&SessionMaterial>,
        mode: RotateMode,
    ) -> Result<RotateResult, FpError> {
        let mut state = self.load()?;
        let now = now_ms();
        let mat = match material {
            Some(m) => material_fingerprint(m),
            None => state.material.clone(),
        };

        let prev_gen = state.generation;
        let prev_binding = state.binding.clone();
        let prev_salt = state.salt.clone();
        let prev_material = state.material.clone();

        // Snapshot for dual window
        state.previous_salt = prev_salt;
        state.previous_binding = prev_binding.clone();
        state.previous_material = prev_material;
        state.previous_generation = Some(prev_gen);
        state.previous_valid_until = Some(now + self.dual_window_ms);

        match mode {
            RotateMode::Salt => {
                state.salt = Some(new_salt(32));
            }
            RotateMode::Generation => {
                state.generation = state.generation.saturating_add(1);
            }
            RotateMode::Both => {
                state.salt = Some(new_salt(32));
                state.generation = state.generation.saturating_add(1);
            }
        }

        let binding = if let (Some(ref m), Some(ref salt)) = (&mat, &state.salt) {
            let b = binding_fingerprint(m, state.generation, salt);
            state.binding = Some(b.clone());
            state.material = Some(m.clone());
            Some(b)
        } else {
            state.binding = None;
            None
        };

        state.rotated_at = Some(now);
        state.history.insert(
            0,
            HistoryEntry {
                at: now,
                mode: format!("{:?}", mode).to_lowercase(),
                generation: state.generation,
                previous_generation: prev_gen,
                dual_window_ms: self.dual_window_ms,
                binding_prefix: binding.as_ref().map(|b| b.chars().take(8).collect()),
            },
        );
        state.history.truncate(HISTORY_CAP);

        self.save(&state)?;

        Ok(RotateResult {
            mode: format!("{:?}", mode).to_lowercase(),
            generation: state.generation,
            previous_generation: prev_gen,
            binding_short: binding.as_ref().map(|b| short_fp(b)),
            previous_binding_short: prev_binding.as_ref().map(|b| short_fp(b)),
            previous_valid_until: now + self.dual_window_ms,
            dual_window_ms: self.dual_window_ms,
            dual_window_open: true,
        })
    }

    pub fn verify(&self, material: &SessionMaterial) -> Result<VerifyOk, FpError> {
        let mat = material_fingerprint(material).ok_or(FpError::NoMaterial)?;
        let state = self.load()?;
        let salt = match &state.salt {
            Some(s) => s.clone(),
            None => {
                // First bind
                self.ensure_binding(material)?;
                return self.verify(material);
            }
        };

        let current = binding_fingerprint(&mat, state.generation, &salt);
        if state.binding.as_ref() == Some(&current) {
            return Ok(VerifyOk::Current {
                generation: state.generation,
                binding_short: short_fp(&current),
            });
        }

        let now = now_ms();
        if dual_window_open(&state, now) {
            let prev_gen = state.previous_generation.unwrap_or(state.generation.saturating_sub(1));
            if let Some(ref prev_salt) = state.previous_salt {
                let prev = binding_fingerprint(&mat, prev_gen, prev_salt);
                if state.previous_binding.as_ref() == Some(&prev) {
                    return Ok(VerifyOk::Previous {
                        generation: prev_gen,
                        binding_short: short_fp(&prev),
                        previous_valid_until: state.previous_valid_until.unwrap_or(0),
                        dual_window_remaining_ms: dual_window_remaining_ms(&state, now),
                    });
                }
            }
        }

        if let Some(ref old_mat) = state.material {
            if old_mat != &mat {
                return Err(FpError::MaterialChanged);
            }
        }
        Err(FpError::BindingMismatch)
    }

    pub fn close_dual_window(&self) -> Result<(), FpError> {
        let mut state = self.load()?;
        state.previous_salt = None;
        state.previous_binding = None;
        state.previous_material = None;
        state.previous_generation = None;
        state.previous_valid_until = None;
        self.save(&state)
    }

    pub fn status(&self) -> Result<FingerprintStatus, FpError> {
        let state = self.load()?;
        Ok(self.status_from(&state))
    }

    fn status_from(&self, state: &FingerprintState) -> FingerprintStatus {
        let now = now_ms();
        FingerprintStatus {
            generation: state.generation,
            has_salt: state.salt.is_some(),
            binding_short: state.binding.as_ref().map(|b| short_fp(b)),
            material_short: state.material.as_ref().map(|m| short_fp(m)),
            rotated_at: state.rotated_at,
            dual_window: DualWindowStatus {
                open: dual_window_open(state, now),
                remaining_ms: dual_window_remaining_ms(state, now),
                previous_valid_until: state.previous_valid_until,
                previous_generation: state.previous_generation,
                previous_binding_short: state
                    .previous_binding
                    .as_ref()
                    .map(|b| short_fp(b)),
            },
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::tempdir;

    #[test]
    fn material_stable() {
        let m = SessionMaterial::from_cookie("a=1");
        assert_eq!(
            material_fingerprint(&m),
            material_fingerprint(&m)
        );
    }

    #[test]
    fn binding_depends_on_salt() {
        let a = binding_fingerprint("mat", 0, "salt1");
        let b = binding_fingerprint("mat", 0, "salt2");
        assert_ne!(a, b);
    }

    #[test]
    fn bind_verify_rotate_dual_window() {
        let dir = tempdir().unwrap();
        let path = dir.path().join("fp.json");
        let store = FingerprintStore::new(&path).with_dual_window_ms(60_000);
        let mat = SessionMaterial::from_cookie("session=rust1");

        store.ensure_binding(&mat).unwrap();
        match store.verify(&mat).unwrap() {
            VerifyOk::Current { .. } => {}
            other => panic!("expected current, got {:?}", other),
        }

        let rot = store.rotate(Some(&mat), RotateMode::Both).unwrap();
        assert!(rot.dual_window_open);
        assert_eq!(rot.previous_generation, 0);
        assert_eq!(rot.generation, 1);

        // Same material under new salt → current match
        match store.verify(&mat).unwrap() {
            VerifyOk::Current { generation, .. } => assert_eq!(generation, 1),
            VerifyOk::Previous { .. } => {}
        }

        let st = store.status().unwrap();
        assert!(st.dual_window.open);
        assert_eq!(st.dual_window.previous_generation, Some(0));

        store.close_dual_window().unwrap();
        assert!(!store.status().unwrap().dual_window.open);
    }

    #[test]
    fn material_change_fails() {
        let dir = tempdir().unwrap();
        let store = FingerprintStore::new(dir.path().join("fp.json"));
        let a = SessionMaterial::from_cookie("session=a");
        let b = SessionMaterial::from_cookie("session=b");
        store.ensure_binding(&a).unwrap();
        let err = store.verify(&b).unwrap_err();
        assert!(matches!(
            err,
            FpError::MaterialChanged | FpError::BindingMismatch
        ));
    }
}
