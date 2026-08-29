/**
 * Wording for doctor's "does the run's tool allowlist name real tools?" row.
 *
 * `compileToolFilter` narrows what a run advertises AND what it dispatches, so
 * an allowlist entry naming a tool that does not exist removes a capability the
 * operator believes they granted. `missingAllowedTools` was written to report
 * exactly that — but it only ever emitted an `onEvent({type:"tools"})` frame,
 * and no surface renders that type: not the voice client, not the channels, not
 * a log line. The warning had no reader.
 *
 * It is not hypothetical. The shipped `act` pack names `xclaw_file_list` and
 * `list_dir`; neither exists in the local registry or on the computer server,
 * so every run under that pack drops the pack's directory-listing capability
 * and says nothing.
 *
 * Pure on purpose: the probe belongs in `runDoctor`, which loads the real
 * config and cannot be pointed at a fixture, so the branches that matter — an
 * unreachable computer server, a probe that returned nothing — would ship
 * untested if the decision lived there.
 */
import { missingAllowedTools } from "../agent/tool-filter.mjs";

/**
 * @param {object} input
 * @param {string[]|null} input.patterns effective allowlist (cfg.agent.allowTools ?? role pack)
 * @param {string[]} input.availableNames tool names this host can actually dispatch
 * @param {boolean} [input.computerReachable] false when the computer server did not answer
 * @returns {{ severity: "ok"|"warn", message: string }}
 */
export function summarizeToolPack({ patterns, availableNames = [], computerReachable = true }) {
  const list = Array.isArray(patterns) ? patterns.filter(Boolean) : [];
  if (!list.length) {
    return { severity: "ok", message: "no allowlist — every available tool is offered" };
  }
  // Most shipped packs are majority computer-plane names. Grading them against
  // a list that could not contain them would report every one as missing, which
  // is the opposite of the truth: the tools exist, the probe failed.
  if (computerReachable === false || !availableNames.length) {
    return {
      severity: "ok",
      message: `${list.length} allowed — unverified (tool inventory unavailable)`,
    };
  }
  const missing = missingAllowedTools(list, availableNames);
  if (!missing.length) {
    return { severity: "ok", message: `${list.length} allowed, all resolve` };
  }
  return {
    severity: "warn",
    message:
      `${list.length} allowed but ${missing.length} name no tool on this host: ` +
      `${missing.join(", ")} — those capabilities are silently absent from every run`,
  };
}
