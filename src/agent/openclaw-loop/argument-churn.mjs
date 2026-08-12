/**
 * Adapted from OpenClaw (MIT) — src/agents/tool-loop-argument-churn.ts
 */
const MIN_STABLE_CALLS_PER_VARIANT = 3;

export function getArgumentChurnNoProgressStreak(history, toolName, currentArgsHash) {
  const outcomes = new Map();
  for (let i = history.length - 1; i >= 0; i -= 1) {
    const record = history[i];
    if (!record || record.toolName !== toolName) break;
    if (!record.resultHash) continue;
    if (record.noProgress !== true && record.outcomeKind !== "terminal-exec-failure") {
      // still count if resultHash stable - OpenClaw checks noProgress flag primarily
    }
    const key = record.argsHash;
    const prev = outcomes.get(key);
    if (!prev) {
      outcomes.set(key, { resultHash: record.resultHash, count: 1 });
    } else if (prev.resultHash === record.resultHash) {
      prev.count += 1;
    }
  }

  let count = 0;
  let variantCount = 0;
  for (const [argsHash, o] of outcomes) {
    if (o.count >= MIN_STABLE_CALLS_PER_VARIANT) {
      variantCount += 1;
      count += o.count;
    }
  }
  // require current args to be part of churn picture
  if (!outcomes.has(currentArgsHash)) {
    return { count: 0, variantCount: 0 };
  }
  return { count, variantCount };
}

export function buildArgumentChurnWarning(toolName, churn) {
  return {
    stuck: true,
    level: "warning",
    detector: "argument_churn",
    count: churn.count,
    message: `WARNING: ${toolName} has cycled through ${churn.variantCount} repeated argument patterns with the same stable outcome ${churn.count} times. Continued churn is treated as stalled run activity, but this tool call remains allowed.`,
    warningKey: `argument-churn:${toolName}`,
    livenessSignal: "argument_churn",
  };
}
