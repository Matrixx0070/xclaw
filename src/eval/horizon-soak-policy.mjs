/**
 * Live soak hard caps from env / opts.
 */
export function loadSoakPolicy(opts = {}) {
  const maxUsd = Number(
    opts.maxUsd ??
      process.env.XCLAW_SOAK_MAX_USD ??
      process.env.XCLAW_MAX_USD ??
      2
  );
  const maxTurns = Number(
    opts.maxTurns ??
      process.env.XCLAW_SOAK_MAX_TURNS ??
      process.env.XCLAW_MAX_TURNS ??
      8
  );
  const usedUsd = Number(opts.usedUsd ?? 0);
  const turns = Number(opts.turns ?? 0);
  return {
    maxUsd: Number.isFinite(maxUsd) && maxUsd > 0 ? maxUsd : 2,
    maxTurns: Number.isFinite(maxTurns) && maxTurns > 0 ? maxTurns : 8,
    usedUsd: Number.isFinite(usedUsd) ? usedUsd : 0,
    turns: Number.isFinite(turns) ? turns : 0,
  };
}

export function checkSoakCaps(policy, next = {}) {
  const usedUsd = Number(next.usedUsd ?? policy.usedUsd ?? 0);
  const turns = Number(next.turns ?? policy.turns ?? 0);
  if (usedUsd > policy.maxUsd) {
    return {
      ok: false,
      code: "SOAK_USD_EXCEEDED",
      reason: `usedUsd ${usedUsd} > maxUsd ${policy.maxUsd}`,
      policy: { ...policy, usedUsd, turns },
    };
  }
  if (turns > policy.maxTurns) {
    return {
      ok: false,
      code: "SOAK_TURNS_EXCEEDED",
      reason: `turns ${turns} > maxTurns ${policy.maxTurns}`,
      policy: { ...policy, usedUsd, turns },
    };
  }
  return {
    ok: true,
    policy: { ...policy, usedUsd, turns },
  };
}

/** Call before each live turn; blocks when over cap. */
export function beforeSoakTurn(policy, state = {}) {
  const turns = Number(state.turns ?? policy.turns ?? 0) + 1;
  const usedUsd = Number(state.usedUsd ?? policy.usedUsd ?? 0);
  return checkSoakCaps(policy, { turns, usedUsd });
}

export default { loadSoakPolicy, checkSoakCaps, beforeSoakTurn };
