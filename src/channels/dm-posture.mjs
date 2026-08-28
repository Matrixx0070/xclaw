/**
 * Who may command the agent over a chat channel.
 *
 * Every security surface used to ask `conf.dmPolicy === "open"`, which answers
 * a different question: what the operator WROTE, not what the channel ENFORCES.
 * The two diverge on Slack, whose gate (channels/slack/index.mjs:133) reads
 * only "allowlist" and whose default is "open" — so an absent field, and the
 * "pairing" every surface recommends as the remedy, both fall through to
 * allow-all. Slack's own source says it plainly: "Without it any sender in a
 * monitored channel (poll) or any @mention (socket) commands the agent."
 *
 * One table, one predicate, mirroring each channel's real gate. A channel that
 * gains or changes a policy is edited here and every reader follows.
 */

/**
 * @type {Record<string, { default: string, enforces: string[] }>}
 * `enforces` is the set of values the channel's gate actually branches on.
 * Anything else — a typo, or a policy that channel never implemented — is
 * allow-all, which is what the code does today for all three.
 */
export const DM_POSTURE = {
  // telegram/index.mjs:95 + 636-671: allowlist, then pairing for DMs, else allow.
  telegram: { default: "pairing", enforces: ["open", "allowlist", "pairing"] },
  // discord/index.mjs:37 + 264-290.
  discord: { default: "pairing", enforces: ["open", "allowlist", "pairing"] },
  // slack/index.mjs:74 + 133: allowlist only, and the default is open.
  slack: { default: "open", enforces: ["allowlist"] },
};

/**
 * The policy a channel will really apply.
 * @param {string} name channel key
 * @param {object} [conf] cfg.channels[name]
 * @returns {string|null} "open" | "allowlist" | "pairing", or null when the
 *   channel has no sender-policy concept at all (email, webchat) — saying
 *   "open" about those would be a finding no operator could act on.
 */
export function effectiveDmPolicy(name, conf = {}) {
  const spec = DM_POSTURE[name];
  if (!spec) return null;
  const want = String(conf?.dmPolicy || spec.default).toLowerCase();
  return spec.enforces.includes(want) ? want : "open";
}

/** True when any sender the channel can see may command the agent. */
export function isOpenDm(name, conf = {}) {
  return effectiveDmPolicy(name, conf) === "open";
}

/**
 * The remedy to print. A fix string is a claim about the product: telling a
 * Slack operator to "prefer pairing" sends them to a value Slack discards.
 */
export function dmRemedy(name) {
  return DM_POSTURE[name]?.enforces.includes("pairing")
    ? "Prefer pairing or allowlist"
    : "Set dmPolicy=allowlist with allowFrom (this channel has no pairing store)";
}

export default { DM_POSTURE, effectiveDmPolicy, isOpenDm, dmRemedy };
