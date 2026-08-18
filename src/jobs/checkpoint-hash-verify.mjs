/**
 * Verify checkpoint toolHashTip matches toolTrace before resume.
 */
import { buildToolHashChain } from "../agent/tool-hash-chain.mjs";

export const CHECKPOINT_HASH_CODES = {
  MISMATCH: "CHECKPOINT_TOOL_HASH_MISMATCH",
  MISSING_TIP: "CHECKPOINT_TOOL_HASH_MISSING",
  OK: "CHECKPOINT_TOOL_HASH_OK",
};

/**
 * @param {object} cp — loaded checkpoint
 * @param {object} [opts]
 * @param {boolean} [opts.requireTip] — fail if tip absent when toolTrace non-empty
 * @returns {{ ok: boolean, code: string, expected?: string, actual?: string, message?: string }}
 */
export function verifyCheckpointToolHash(cp = {}, opts = {}) {
  const trace = Array.isArray(cp.toolTrace) ? cp.toolTrace : [];
  const tip = cp.toolHashTip || null;

  if (!tip && trace.length === 0) {
    return { ok: true, code: CHECKPOINT_HASH_CODES.OK, expected: null, actual: null };
  }

  const chain = buildToolHashChain(trace);
  const expected = chain.tip;

  if (!tip) {
    if (opts.requireTip === true) {
      return {
        ok: false,
        code: CHECKPOINT_HASH_CODES.MISSING_TIP,
        expected,
        actual: null,
        message: "checkpoint missing toolHashTip",
      };
    }
    return {
      ok: true,
      code: CHECKPOINT_HASH_CODES.MISSING_TIP,
      expected,
      actual: null,
      legacy: true,
    };
  }

  if (tip !== expected) {
    return {
      ok: false,
      code: CHECKPOINT_HASH_CODES.MISMATCH,
      expected,
      actual: tip,
      message: `checkpoint toolHashTip mismatch (stored=${String(tip).slice(0, 12)}… expected=${String(expected).slice(0, 12)}…)`,
    };
  }

  return { ok: true, code: CHECKPOINT_HASH_CODES.OK, expected, actual: tip };
}

export default { verifyCheckpointToolHash, CHECKPOINT_HASH_CODES };
