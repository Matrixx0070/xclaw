/**
 * Key Compromise Recovery (KCR) for XClaw signing keys.
 *
 * Playbook when a private key or key store may be exposed:
 *  1. quarantine  — stop auto-rotate thrash; flag compromised generations
 *  2. emergency_rotate — new keypair immediately
 *  3. close_dual_window — reject previous key NOW (no overlap)
 *  4. revoke — record revoked kids/generations (deny list)
 *  5. reencrypt — if secret changed, re-wrap private blob
 *  6. audit — immutable-ish event log for forensics
 *
 * verifyWithRecovery() refuses signatures from revoked kids even if
 * they would otherwise pass crypto verify.
 */
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import crypto from "node:crypto";
import {
  durableAtomicWriteJson,
  durableWritesEnabled,
} from "../utils/durable-write.mjs";
import {
  ensureKeyStore,
  rotateKeys,
  closeDualWindow,
  getVerificationKeys,
  keyRotationStatus,
  verifyWithRotatedKeys,
} from "./key-rotation.mjs";

function paths(cfg = {}) {
  const configDir =
    cfg.paths?.configDir ||
    process.env.XCLAW_CONFIG_DIR ||
    path.join(os.homedir(), ".xclaw");
  return {
    configDir,
    recoveryPath:
      cfg.auth?.keys?.recoveryPath ||
      path.join(configDir, "key-recovery.json"),
    storePath:
      cfg.auth?.keys?.storePath || path.join(configDir, "key-rotation.json"),
  };
}

async function readRecovery(cfg) {
  try {
    return JSON.parse(await fs.readFile(paths(cfg).recoveryPath, "utf8"));
  } catch {
    return {
      version: 1,
      quarantined: false,
      revokedKids: [],
      revokedGenerations: [],
      events: [],
    };
  }
}

async function writeRecovery(cfg, rec) {
  const p = paths(cfg).recoveryPath;
  await durableAtomicWriteJson(p, rec, {
    durable: durableWritesEnabled(cfg),
    mode: 0o600,
    dirMode: 0o700,
  });
}

function pushEvent(rec, type, details = {}) {
  rec.events = [
    {
      at: Date.now(),
      type,
      id: crypto.randomBytes(8).toString("hex"),
      ...details,
    },
    ...(rec.events || []),
  ].slice(0, 100);
}

/**
 * Mark system quarantined: operators should pause non-essential signing
 * until recoverFromCompromise completes.
 */
export async function quarantineKeys(cfg = {}, reason = "suspected_compromise") {
  const rec = await readRecovery(cfg);
  rec.quarantined = true;
  rec.quarantinedAt = Date.now();
  rec.quarantineReason = reason;
  pushEvent(rec, "quarantine", { reason });
  await writeRecovery(cfg, rec);
  return { ok: true, quarantined: true, reason };
}

export async function liftQuarantine(cfg = {}, note = "recovery_complete") {
  const rec = await readRecovery(cfg);
  rec.quarantined = false;
  rec.quarantineLiftedAt = Date.now();
  pushEvent(rec, "quarantine_lifted", { note });
  await writeRecovery(cfg, rec);
  return { ok: true, quarantined: false };
}

export async function isQuarantined(cfg = {}) {
  const rec = await readRecovery(cfg);
  return Boolean(rec.quarantined);
}

/**
 * Revoke specific kids / generations (deny list for verify).
 */
export async function revokeKids(cfg = {}, { kids = [], generations = [], reason } = {}) {
  const rec = await readRecovery(cfg);
  const kidSet = new Set(rec.revokedKids || []);
  const genSet = new Set(rec.revokedGenerations || []);
  for (const k of kids) if (k) kidSet.add(String(k));
  for (const g of generations) if (g != null) genSet.add(Number(g));
  rec.revokedKids = [...kidSet];
  rec.revokedGenerations = [...genSet];
  pushEvent(rec, "revoke", {
    kids,
    generations,
    reason: reason || "compromise",
  });
  await writeRecovery(cfg, rec);
  return {
    ok: true,
    revokedKids: rec.revokedKids,
    revokedGenerations: rec.revokedGenerations,
  };
}

export async function isRevoked(cfg, { kid, generation } = {}) {
  const rec = await readRecovery(cfg);
  if (kid && (rec.revokedKids || []).includes(String(kid))) return true;
  if (
    generation != null &&
    (rec.revokedGenerations || []).includes(Number(generation))
  ) {
    return true;
  }
  return false;
}

/** Retain public JWKs for revoked kids (verify attribution after dual-window close). */
export async function rememberRevokedPublicKeys(cfg = {}, entries = []) {
  const rec = await readRecovery(cfg);
  const pubs = Array.isArray(rec.revokedPublicKeys) ? [...rec.revokedPublicKeys] : [];
  for (const e of entries || []) {
    if (!e?.publicJwk || !e?.kid) continue;
    if (pubs.some((p) => p.kid === e.kid)) continue;
    pubs.push({
      kid: e.kid,
      generation: e.generation,
      publicJwk: e.publicJwk,
    });
  }
  rec.revokedPublicKeys = pubs;
  await writeRecovery(cfg, rec);
  return { ok: true, count: pubs.length };
}


/**
 * Full recovery playbook:
 *  1. quarantine
 *  2. snapshot status (which keys exist)
 *  3. revoke current + previous kids
 *  4. emergency rotate (new generation)
 *  5. close dual window (no overlap with compromised material)
 *  6. optional lift quarantine
 */
export async function recoverFromCompromise(cfg = {}, opts = {}) {
  const reason = opts.reason || "key_compromise";
  const steps = [];

  await ensureKeyStore(cfg);
  const before = await keyRotationStatus(cfg);
  steps.push({ step: "snapshot", before });

  // 1. Quarantine
  await quarantineKeys(cfg, reason);
  steps.push({ step: "quarantine", ok: true });

  // 2. Revoke known kids (current + previous in dual window)
  const kids = [before.kid, before.dualWindow?.previousKid].filter(Boolean);
  const gens = [
    before.generation,
    before.dualWindow?.previousGeneration,
  ].filter((g) => g != null);
  const rev = await revokeKids(cfg, {
    kids,
    generations: gens,
    reason,
  });
  steps.push({ step: "revoke", ...rev });
  {
    const rec2 = await readRecovery(cfg);
    const pubs = Array.isArray(rec2.revokedPublicKeys) ? [...rec2.revokedPublicKeys] : [];
    if (before?.publicJwk && before?.kid) {
      pubs.push({
        kid: before.kid,
        generation: before.generation,
        publicJwk: before.publicJwk,
      });
    }
    if (before?.dualWindow?.previousKid) {
      // previous slot if present on store
    }
    rec2.revokedPublicKeys = pubs;
    await writeRecovery(cfg, rec2);
  }

  // 3. Emergency rotate — force new key material
  const rotated = await rotateKeys(cfg, {
    reason: `compromise:${reason}`,
    dualWindowMs: 0, // no overlap with old keys
    retainPreviousPrivate: false,
  });
  steps.push({ step: "emergency_rotate", ...rotated });

  // 4. Close dual window explicitly (belt and suspenders)
  const closed = await closeDualWindow(cfg);
  steps.push({ step: "close_dual_window", ...closed });

  // 5. Confirm previous not in verification set
  const keys = await getVerificationKeys(cfg);
  const leaked = keys.filter(
    (k) => kids.includes(k.kid) || gens.includes(k.generation)
  );
  steps.push({
    step: "verify_clean",
    activeKids: keys.map((k) => k.kid),
    compromisedStillActive: leaked.length > 0,
  });

  if (opts.liftQuarantine !== false) {
    await liftQuarantine(cfg, "recovery_complete");
    steps.push({ step: "lift_quarantine", ok: true });
  }

  const after = await keyRotationStatus(cfg);
  const rec = await readRecovery(cfg);
  pushEvent(rec, "recover_complete", {
    reason,
    newKid: after.kid,
    newGeneration: after.generation,
  });
  await writeRecovery(cfg, rec);

  return {
    ok: leaked.length === 0,
    reason,
    newKid: after.kid,
    newGeneration: after.generation,
    revokedKids: rec.revokedKids,
    steps,
  };
}

/**
 * Verify signature but reject revoked kids/generations.
 */
export async function verifyWithRecovery(cfg, data, signature, opts = {}) {
  if (opts.respectQuarantine !== false && (await isQuarantined(cfg))) {
    // Still allow verify of non-revoked during quarantine (read path),
    // but surface warning — signing should be blocked separately.
  }

  const result = await verifyWithRotatedKeys(cfg, data, signature, opts);
  if (result.ok) {
    if (await isRevoked(cfg, { kid: result.kid, generation: result.generation })) {
      return {
        ok: false,
        error: "signature key has been revoked (compromise recovery)",
        code: "KEY_REVOKED",
        kid: result.kid,
        generation: result.generation,
      };
    }
    return result;
  }

  const rec = await readRecovery(cfg);
  const dataBuf = Buffer.from(data);
  const sigBuf = Buffer.from(signature);
  for (const entry of rec.revokedPublicKeys || []) {
    if (!entry?.publicJwk) continue;
    try {
      const pub = crypto.createPublicKey({ key: entry.publicJwk, format: "jwk" });
      const ok = crypto.verify(
        "sha256",
        dataBuf,
        { key: pub, dsaEncoding: "ieee-p1363" },
        sigBuf
      );
      if (ok) {
        return {
          ok: false,
          error: "signature key has been revoked (compromise recovery)",
          code: "KEY_REVOKED",
          kid: entry.kid,
          generation: entry.generation,
        };
      }
    } catch {
      /* next */
    }
  }
  return result;
}

/**
 * Block signing while quarantined (call before signWithCurrentKey).
 */
export async function assertCanSign(cfg = {}) {
  if (await isQuarantined(cfg)) {
    const rec = await readRecovery(cfg);
    const err = new Error(
      `signing blocked: keys quarantined (${rec.quarantineReason || "compromise"})`
    );
    err.code = "QUARANTINED";
    throw err;
  }
  return true;
}

export async function recoveryStatus(cfg = {}) {
  const rec = await readRecovery(cfg);
  const keys = await keyRotationStatus(cfg).catch(() => ({ initialized: false }));
  return {
    quarantined: Boolean(rec.quarantined),
    quarantineReason: rec.quarantineReason || null,
    quarantinedAt: rec.quarantinedAt || null,
    revokedKids: rec.revokedKids || [],
    revokedGenerations: rec.revokedGenerations || [],
    recentEvents: (rec.events || []).slice(0, 10),
    keyStore: keys,
  };
}
