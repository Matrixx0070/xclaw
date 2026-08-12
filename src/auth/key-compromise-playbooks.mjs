/**
 * Key Compromise Recovery Playbooks — named, severity-tiered runbooks.
 *
 * Playbooks:
 *   soft_suspect   — quarantine only; ops investigate; no rotate yet
 *   previous_leak  — revoke previous kid only; close dual window; keep current
 *   current_leak   — full recoverFromCompromise (revoke all live, emergency rotate)
 *   full_host      — current_leak + keep quarantine until explicit lift
 *   drain_then_cut — close dual window, short wait metadata, then full recovery
 *
 * runPlaybook(cfg, name, opts) executes steps and returns a structured report.
 */
import {
  quarantineKeys,
  liftQuarantine,
  revokeKids,
  recoverFromCompromise,
  recoveryStatus,
  assertCanSign,
  isQuarantined,
} from "./key-compromise-recovery.mjs";
import {
  ensureKeyStore,
  keyRotationStatus,
  closeDualWindow,
  getVerificationKeys,
  rotateKeys,
} from "./key-rotation.mjs";

/** @typedef {"soft_suspect"|"previous_leak"|"current_leak"|"full_host"|"drain_then_cut"} PlaybookName */

export const PLAYBOOKS = {
  soft_suspect: {
    id: "soft_suspect",
    severity: "low",
    title: "Soft suspect — quarantine only",
    description:
      "Pause signing and investigate. Does not rotate or revoke. Lift quarantine manually when clear.",
    steps: [
      "snapshot",
      "quarantine",
      "status",
    ],
    autoLiftQuarantine: false,
    emergencyRotate: false,
  },
  previous_leak: {
    id: "previous_leak",
    severity: "medium",
    title: "Previous-key leak — close overlap + revoke previous",
    description:
      "Dual-window previous key may be exposed. Revoke previous kid/gen, close dual window, keep current signing key.",
    steps: [
      "snapshot",
      "quarantine",
      "revoke_previous",
      "close_dual_window",
      "verify_clean_previous",
      "lift_quarantine",
    ],
    autoLiftQuarantine: true,
    emergencyRotate: false,
  },
  current_leak: {
    id: "current_leak",
    severity: "high",
    title: "Current-key leak — full emergency recovery",
    description:
      "Active signing key may be exposed. Revoke current+previous, emergency rotate with zero dual window, resume on new key.",
    steps: [
      "full_recover",
    ],
    autoLiftQuarantine: true,
    emergencyRotate: true,
  },
  full_host: {
    id: "full_host",
    severity: "critical",
    title: "Host compromise — full recovery, stay quarantined",
    description:
      "Host or store may be fully compromised. Run full recovery but leave quarantine on until ops explicitly lifts.",
    steps: [
      "full_recover_stay_quarantined",
    ],
    autoLiftQuarantine: false,
    emergencyRotate: true,
  },
  drain_then_cut: {
    id: "drain_then_cut",
    severity: "high",
    title: "Drain dual window then hard cut + rotate",
    description:
      "Close dual window first (stop previous verify), then full emergency recovery. Use when previous must die before re-key.",
    steps: [
      "snapshot",
      "quarantine",
      "close_dual_window",
      "full_recover",
    ],
    autoLiftQuarantine: true,
    emergencyRotate: true,
  },
};

export function listPlaybooks() {
  return Object.values(PLAYBOOKS).map((p) => ({
    id: p.id,
    severity: p.severity,
    title: p.title,
    description: p.description,
    steps: p.steps,
    autoLiftQuarantine: p.autoLiftQuarantine,
    emergencyRotate: p.emergencyRotate,
  }));
}

export function getPlaybook(name) {
  const p = PLAYBOOKS[name];
  if (!p) {
    const err = new Error(
      `unknown playbook "${name}". Valid: ${Object.keys(PLAYBOOKS).join(", ")}`
    );
    err.code = "UNKNOWN_PLAYBOOK";
    throw err;
  }
  return p;
}

/**
 * Execute a named compromise recovery playbook.
 *
 * @param {object} cfg
 * @param {PlaybookName|string} name
 * @param {object} [opts]
 * @param {string} [opts.reason]
 * @param {boolean} [opts.dryRun] — snapshot + plan only, no mutations
 */
export async function runPlaybook(cfg = {}, name, opts = {}) {
  const playbook = getPlaybook(name);
  const reason = opts.reason || `playbook:${playbook.id}`;
  const dryRun = Boolean(opts.dryRun);
  const report = {
    playbook: playbook.id,
    severity: playbook.severity,
    title: playbook.title,
    reason,
    dryRun,
    startedAt: Date.now(),
    steps: [],
    ok: false,
  };

  await ensureKeyStore(cfg);
  const before = await keyRotationStatus(cfg);
  report.steps.push({ step: "snapshot", before: summarizeStatus(before) });

  if (dryRun) {
    report.steps.push({
      step: "plan",
      wouldRun: playbook.steps,
      autoLiftQuarantine: playbook.autoLiftQuarantine,
      emergencyRotate: playbook.emergencyRotate,
    });
    report.ok = true;
    report.finishedAt = Date.now();
    return report;
  }

  try {
    for (const step of playbook.steps) {
      const result = await runStep(cfg, step, {
        reason,
        before,
        playbook,
        opts,
      });
      report.steps.push({ step, ...result });
      if (result.ok === false) {
        report.ok = false;
        report.error = result.error || `step ${step} failed`;
        report.finishedAt = Date.now();
        return report;
      }
    }
    report.ok = true;
  } catch (e) {
    report.ok = false;
    report.error = e.message || String(e);
    report.code = e.code;
  }

  report.after = summarizeStatus(await keyRotationStatus(cfg));
  report.recovery = await recoveryStatus(cfg);
  report.finishedAt = Date.now();
  return report;
}

function summarizeStatus(st) {
  if (!st || st.initialized === false) return st;
  return {
    generation: st.generation,
    kid: st.kid,
    useCount: st.useCount,
    dualWindowOpen: st.dualWindow?.open,
    previousKid: st.dualWindow?.previousKid,
  };
}

async function runStep(cfg, step, ctx) {
  const { reason, before, playbook } = ctx;

  switch (step) {
    case "snapshot":
      return { ok: true, status: summarizeStatus(before) };

    case "quarantine":
      return { ok: true, ...(await quarantineKeys(cfg, reason)) };

    case "status":
      return { ok: true, recovery: await recoveryStatus(cfg) };

    case "revoke_previous": {
      const kids = [before.dualWindow?.previousKid].filter(Boolean);
      const generations = [before.dualWindow?.previousGeneration].filter(
        (g) => g != null
      );
      if (!kids.length && !generations.length) {
        return {
          ok: true,
          skipped: true,
          message: "no previous key in dual window",
        };
      }
      return {
        ok: true,
        ...(await revokeKids(cfg, { kids, generations, reason })),
      };
    }

    case "close_dual_window":
      return { ok: true, ...(await closeDualWindow(cfg)) };

    case "verify_clean_previous": {
      const keys = await getVerificationKeys(cfg);
      const prevKid = before.dualWindow?.previousKid;
      const still = prevKid && keys.some((k) => k.kid === prevKid);
      return {
        ok: !still,
        activeKids: keys.map((k) => k.kid),
        previousStillActive: Boolean(still),
        error: still ? "previous key still in verification set" : undefined,
      };
    }

    case "lift_quarantine":
      return { ok: true, ...(await liftQuarantine(cfg, `playbook:${playbook.id}`)) };

    case "full_recover": {
      const r = await recoverFromCompromise(cfg, {
        reason,
        liftQuarantine: playbook.autoLiftQuarantine,
      });
      return { ok: r.ok, ...r };
    }

    case "full_recover_stay_quarantined": {
      const r = await recoverFromCompromise(cfg, {
        reason,
        liftQuarantine: false,
      });
      return { ok: r.ok, ...r };
    }

    default:
      return { ok: false, error: `unknown step ${step}` };
  }
}

/**
 * Recommend a playbook from a simple incident signal.
 */
export function recommendPlaybook(signal = {}) {
  const {
    hostCompromise = false,
    currentKeyLeaked = false,
    previousKeyLeaked = false,
    suspectOnly = false,
    drainFirst = false,
  } = signal;

  if (hostCompromise) return "full_host";
  if (currentKeyLeaked && drainFirst) return "drain_then_cut";
  if (currentKeyLeaked) return "current_leak";
  if (previousKeyLeaked) return "previous_leak";
  if (suspectOnly) return "soft_suspect";
  return "current_leak"; // safe default when unsure
}

/**
 * Guard: refuse sign unless playbook allows (not quarantined).
 */
export async function playbookAssertCanSign(cfg) {
  return assertCanSign(cfg);
}

export async function playbookIsQuarantined(cfg) {
  return isQuarantined(cfg);
}
