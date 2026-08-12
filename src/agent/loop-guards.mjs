/**
 * XClaw loop guards — OpenClaw-ported detection (MIT adapted).
 */
import { createOpenClawLoopDetector } from "./openclaw-loop/detection.mjs";

/**
 * @param {object} [config] OpenClaw-compatible loopDetection overrides
 */
export function createLoopGuard(config = {}) {
  const detector = createOpenClawLoopDetector(config);

  function record(toolName, params, resultText, details) {
    return detector.record(toolName, params, resultText, details);
  }

  function detect(toolName, params, opts) {
    const r = detector.detect(toolName, params, opts);
    // Normalize for existing loop.mjs expectations
    if (!r.stuck) {
      return { stuck: false, level: "ok", detector: null, message: null };
    }
    return {
      stuck: true,
      level: r.level,
      kind: r.detector,
      detector: r.detector,
      count: r.count,
      message: r.message,
      pairedToolName: r.pairedToolName,
      warningKey: r.warningKey,
      livenessSignal: r.livenessSignal,
    };
  }

  return {
    record,
    detect,
    snapshot: () => detector.snapshot(),
    reset: () => detector.reset(),
  };
}

export { createOpenClawLoopDetector } from "./openclaw-loop/detection.mjs";
