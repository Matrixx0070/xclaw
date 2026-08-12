/**
 * Adapted from OpenClaw (MIT) — src/agents/tool-loop-detection.ts
 * https://github.com/openclaw/openclaw
 *
 * Tool-call loop detection: repeated no-progress patterns + circuit breaker.
 * Ported to plain ESM for XClaw (no OpenClaw session/logger deps).
 */
import { createHash } from "node:crypto";
import { TOOL_LOOP_WARNING_THRESHOLD } from "./thresholds.mjs";
import { isKnownPollToolCall } from "./call-kind.mjs";
import { isWriteNoProgressOutcome } from "./write-outcome.mjs";
import { getNoProgressStreak } from "./no-progress.mjs";
import {
  getArgumentChurnNoProgressStreak,
  buildArgumentChurnWarning,
} from "./argument-churn.mjs";

const TOOL_CALL_HISTORY_SIZE = 30;
export const UNKNOWN_TOOL_THRESHOLD = 10;
const CRITICAL_THRESHOLD = 20;
const GLOBAL_CIRCUIT_BREAKER_THRESHOLD = 30;

const DEFAULT_LOOP_DETECTION_CONFIG = {
  enabled: true, // XClaw default on (OpenClaw default was false)
  historySize: TOOL_CALL_HISTORY_SIZE,
  warningThreshold: TOOL_LOOP_WARNING_THRESHOLD,
  unknownToolThreshold: UNKNOWN_TOOL_THRESHOLD,
  criticalThreshold: CRITICAL_THRESHOLD,
  globalCircuitBreakerThreshold: GLOBAL_CIRCUIT_BREAKER_THRESHOLD,
  detectors: {
    genericRepeat: true,
    knownPollNoProgress: true,
    pingPong: true,
    argumentChurn: true,
  },
};

function digestStable(value) {
  const s = typeof value === "string" ? value : JSON.stringify(value ?? null);
  return createHash("sha256").update(s).digest("hex").slice(0, 24);
}

function hashToolCall(toolName, params) {
  return digestStable({ toolName, params: params ?? {} });
}

function canonicalPairKey(a, b) {
  return a < b ? `${a}|${b}` : `${b}|${a}`;
}

function resolveConfig(user = {}) {
  const merged = {
    ...DEFAULT_LOOP_DETECTION_CONFIG,
    ...user,
    detectors: {
      ...DEFAULT_LOOP_DETECTION_CONFIG.detectors,
      ...(user.detectors || {}),
    },
  };
  // Alias: config historically used circuitBreaker
  if (
    user.globalCircuitBreakerThreshold == null &&
    user.circuitBreaker != null
  ) {
    merged.globalCircuitBreakerThreshold = Number(user.circuitBreaker);
  }
  // Env overrides (ops)
  const envGlobal = process.env.XCLAW_LOOP_GUARD_GLOBAL;
  const envCrit = process.env.XCLAW_LOOP_GUARD_CRITICAL;
  const envWarn = process.env.XCLAW_LOOP_GUARD_WARNING;
  const envOff = process.env.XCLAW_LOOP_GUARD;
  if (envOff === "0" || envOff === "false" || envOff === "off") {
    merged.enabled = false;
  }
  if (envGlobal != null && envGlobal !== "") {
    merged.globalCircuitBreakerThreshold = Number(envGlobal);
  }
  if (envCrit != null && envCrit !== "") {
    merged.criticalThreshold = Number(envCrit);
  }
  if (envWarn != null && envWarn !== "") {
    merged.warningThreshold = Number(envWarn);
  }
  // Keep history at least as large as the global breaker window
  if (merged.historySize < merged.globalCircuitBreakerThreshold) {
    merged.historySize = merged.globalCircuitBreakerThreshold;
  }
  return merged;
}

function getPingPongStreak(history, currentSignature) {
  const last = history.at(-1);
  if (!last) return { count: 0, noProgressEvidence: false };

  let otherSignature;
  let otherToolName;
  for (let i = history.length - 2; i >= 0; i -= 1) {
    const call = history[i];
    if (!call) continue;
    if (call.argsHash !== last.argsHash) {
      otherSignature = call.argsHash;
      otherToolName = call.toolName;
      break;
    }
  }
  if (!otherSignature || !otherToolName) {
    return { count: 0, noProgressEvidence: false };
  }

  let alternatingTailCount = 0;
  for (let i = history.length - 1; i >= 0; i -= 1) {
    const call = history[i];
    if (!call) continue;
    const expected = alternatingTailCount % 2 === 0 ? last.argsHash : otherSignature;
    if (call.argsHash !== expected) break;
    alternatingTailCount += 1;
  }
  if (alternatingTailCount < 2) return { count: 0, noProgressEvidence: false };
  if (currentSignature !== otherSignature) {
    return { count: 0, noProgressEvidence: false };
  }

  const tailStart = Math.max(0, history.length - alternatingTailCount);
  let firstHashA;
  let firstHashB;
  let noProgressEvidence = true;
  for (let i = tailStart; i < history.length; i += 1) {
    const call = history[i];
    if (!call || !call.resultHash) {
      noProgressEvidence = false;
      break;
    }
    if (call.argsHash === last.argsHash) {
      if (!firstHashA) firstHashA = call.resultHash;
      else if (firstHashA !== call.resultHash) {
        noProgressEvidence = false;
        break;
      }
    } else if (call.argsHash === otherSignature) {
      if (!firstHashB) firstHashB = call.resultHash;
      else if (firstHashB !== call.resultHash) {
        noProgressEvidence = false;
        break;
      }
    } else {
      noProgressEvidence = false;
      break;
    }
  }
  if (!firstHashA || !firstHashB) noProgressEvidence = false;

  return {
    count: alternatingTailCount + 1,
    pairedToolName: last.toolName,
    pairedSignature: otherSignature,
    noProgressEvidence,
  };
}

function getUnknownToolRepeatStreak(history, toolName) {
  let streak = 0;
  let repeatedUnknownToolName;
  for (let i = history.length - 1; i >= 0; i -= 1) {
    const record = history[i];
    if (!record || record.toolName !== toolName || !record.unknownToolName) break;
    if (!repeatedUnknownToolName) {
      repeatedUnknownToolName = record.unknownToolName;
      streak = 1;
      continue;
    }
    if (record.unknownToolName !== repeatedUnknownToolName) break;
    streak += 1;
  }
  return { count: streak, unknownToolName: repeatedUnknownToolName };
}

/**
 * Hash tool outcome for no-progress tracking (simplified from OpenClaw).
 */
export function hashToolOutcome(toolName, params, resultText, details = {}) {
  if (toolName === "write" && isWriteNoProgressOutcome(details)) {
    return { resultHash: digestStable({ status: "unchanged" }), noProgress: true };
  }
  if (
    (toolName === "exec" || toolName === "xclaw_bash" || toolName === "bash") &&
    details.exitCode != null
  ) {
    const exitCode = details.exitCode;
    const output = String(resultText || "").trim();
    const execHash = digestStable({ exitCode, output: output.slice(0, 2000) });
    const terminalFailure =
      typeof exitCode === "number" &&
      exitCode !== 0 &&
      details.timedOut !== true &&
      output !== "";
    return terminalFailure
      ? { resultHash: execHash, outcomeKind: "terminal-exec-failure" }
      : { resultHash: execHash };
  }
  return {
    resultHash: digestStable({ text: String(resultText || "").slice(0, 4000), details }),
  };
}

/**
 * Create OpenClaw-style loop detector for XClaw.
 */
export function createOpenClawLoopDetector(userConfig = {}) {
  const resolvedConfig = resolveConfig(userConfig);
  /** @type {Array<object>} */
  const history = [];

  function record(toolName, params, resultText, details = {}) {
    if (!resolvedConfig.enabled) return;
    const argsHash = hashToolCall(toolName, params);
    const outcome = hashToolOutcome(toolName, params, resultText, details);
    history.push({
      toolName,
      argsHash,
      resultHash: outcome.resultHash,
      noProgress: outcome.noProgress,
      outcomeKind: outcome.outcomeKind,
      unknownToolName: details.unknownToolName,
      ts: Date.now(),
    });
    while (history.length > resolvedConfig.historySize) history.shift();
  }

  /**
   * Pre-call detection (OpenClaw detectToolCallLoop pattern).
   */
  function detect(toolName, params, opts = {}) {
    if (!resolvedConfig.enabled) return { stuck: false };

    const currentHash = hashToolCall(toolName, params);
    const knownPollTool = isKnownPollToolCall(toolName, params);

    // Global circuit breaker — progress-aware:
    // Critical only when call count is high AND no-progress streak is elevated,
    // or absolute hard ceiling (1.5x threshold) to still bound runaways.
    if (history.length >= resolvedConfig.globalCircuitBreakerThreshold) {
      // Overall stall: same tool+args no-progress on the latest entry
      const last = history[history.length - 1];
      const streakInfo = last
        ? getNoProgressStreak(history, last.toolName, last.argsHash)
        : { count: 0 };
      const noProg = Number(streakInfo?.count || 0);
      const hardCeiling = Math.ceil(
        resolvedConfig.globalCircuitBreakerThreshold * 1.5
      );
      const progressStalled =
        noProg >= Math.max(3, resolvedConfig.warningThreshold || 3);
      if (progressStalled || history.length >= hardCeiling) {
        return {
          stuck: true,
          level: "critical",
          detector: "global_circuit_breaker",
          count: history.length,
          noProgressStreak: noProg,
          message: `CRITICAL: ${history.length} tool calls with insufficient progress (no-progress streak ${noProg}). Soft-stopping to prevent runaway loops.`,
        };
      }
      // Still moving: warn but do not critical-stop yet
      return {
        stuck: true,
        level: "warning",
        detector: "global_circuit_breaker_soft",
        count: history.length,
        noProgressStreak: noProg,
        message: `WARNING: ${history.length} tool calls (threshold ${resolvedConfig.globalCircuitBreakerThreshold}) but progress still detected. Prefer finishing soon.`,
      };
    }

    // Unknown tool repeats
    if (opts.unknownToolName) {
      const u = getUnknownToolRepeatStreak(
        [...history, { toolName, unknownToolName: opts.unknownToolName }],
        toolName
      );
      if (u.count >= resolvedConfig.unknownToolThreshold) {
        return {
          stuck: true,
          level: "critical",
          detector: "unknown_tool_repeat",
          count: u.count,
          message: `CRITICAL: Unknown tool "${u.unknownToolName}" repeated ${u.count} times.`,
        };
      }
    }

    const noProgress = getNoProgressStreak(history, toolName, currentHash);
    const noProgressStreak = noProgress.count;

    // Argument churn
    let argumentChurnLivenessSignal;
    if (resolvedConfig.detectors.argumentChurn) {
      const churn = getArgumentChurnNoProgressStreak(history, toolName, currentHash);
      if (churn.variantCount >= 2 && churn.count >= resolvedConfig.warningThreshold) {
        argumentChurnLivenessSignal = "argument_churn";
        if (churn.count >= resolvedConfig.criticalThreshold) {
          return {
            stuck: true,
            level: "critical",
            detector: "argument_churn",
            count: churn.count,
            message: `CRITICAL: ${toolName} argument churn with stable outcomes (${churn.count} calls, ${churn.variantCount} variants).`,
            warningKey: `argument-churn:${toolName}`,
            livenessSignal: "argument_churn",
          };
        }
        return buildArgumentChurnWarning(toolName, churn);
      }
    }

    // Ping-pong
    const pingPong = getPingPongStreak(history, currentHash);
    const pingPongWarningKey = pingPong.pairedSignature
      ? `pingpong:${canonicalPairKey(currentHash, pingPong.pairedSignature)}`
      : `pingpong:${toolName}:${currentHash}`;

    if (
      resolvedConfig.detectors.pingPong &&
      pingPong.count >= resolvedConfig.criticalThreshold &&
      pingPong.noProgressEvidence
    ) {
      return {
        stuck: true,
        level: "critical",
        detector: "ping_pong",
        count: pingPong.count,
        message: `CRITICAL: Alternating tool-call patterns (${pingPong.count} consecutive calls) with no progress (ping-pong loop).`,
        pairedToolName: pingPong.pairedToolName,
        warningKey: pingPongWarningKey,
      };
    }
    if (resolvedConfig.detectors.pingPong && pingPong.count >= resolvedConfig.warningThreshold) {
      return {
        stuck: true,
        level: "warning",
        detector: "ping_pong",
        count: pingPong.count,
        message: `WARNING: Alternating tool-call patterns (${pingPong.count} consecutive calls) look like a ping-pong loop.`,
        pairedToolName: pingPong.pairedToolName,
        warningKey: pingPongWarningKey,
        ...(argumentChurnLivenessSignal
          ? { livenessSignal: argumentChurnLivenessSignal }
          : {}),
      };
    }

    // Known poll no-progress
    if (
      knownPollTool &&
      resolvedConfig.detectors.knownPollNoProgress &&
      noProgressStreak >= resolvedConfig.warningThreshold
    ) {
      const level =
        noProgressStreak >= resolvedConfig.criticalThreshold ? "critical" : "warning";
      return {
        stuck: true,
        level,
        detector: "known_poll_no_progress",
        count: noProgressStreak,
        message: `${level === "critical" ? "CRITICAL" : "WARNING"}: Poll tool ${toolName} repeated with no progress ${noProgressStreak} times.`,
      };
    }

    // Generic repeat with no-progress proof
    if (
      !knownPollTool &&
      resolvedConfig.detectors.genericRepeat &&
      noProgressStreak >= resolvedConfig.criticalThreshold
    ) {
      return {
        stuck: true,
        level: "critical",
        detector: "generic_repeat",
        count: noProgressStreak,
        message: `CRITICAL: Called ${toolName} with identical outcomes ${noProgressStreak} times. Session execution blocked.`,
        warningKey: `generic:${toolName}:${currentHash}:${noProgress.latestResultHash ?? "none"}`,
      };
    }

    if (
      !knownPollTool &&
      resolvedConfig.detectors.genericRepeat &&
      noProgressStreak >= resolvedConfig.warningThreshold
    ) {
      return {
        stuck: true,
        level: "warning",
        detector: "generic_repeat",
        count: noProgressStreak,
        message: `WARNING: Called ${toolName} with identical outcomes ${noProgressStreak} times. Avoid repeating the same failing action.`,
        warningKey: `generic:${toolName}:${currentHash}:${noProgress.latestResultHash ?? "none"}`,
      };
    }

    // Soft warn: many identical args even without result proof yet
    const recentCount = history.filter(
      (h) => h.toolName === toolName && h.argsHash === currentHash
    ).length;
    if (
      !knownPollTool &&
      resolvedConfig.detectors.genericRepeat &&
      recentCount >= resolvedConfig.warningThreshold
    ) {
      return {
        stuck: true,
        level: "warning",
        detector: "generic_repeat",
        count: recentCount,
        message: `WARNING: ${toolName} called ${recentCount} times with identical arguments.`,
        warningKey: `generic-args:${toolName}:${currentHash}`,
      };
    }

    return { stuck: false };
  }

  function snapshot() {
    return { historyLen: history.length, config: resolvedConfig };
  }

  function reset() {
    history.length = 0;
  }

  return { detect, record, snapshot, reset, config: resolvedConfig };
}
