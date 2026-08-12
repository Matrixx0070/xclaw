/**
 * Sliding-window eviction for XClaw message lists.
 *
 * Guarantees:
 *  - System prefix (leading role:system) is never part of the window cut
 *  - Window keeps the newest messages up to maxMessages / maxTokens
 *  - Optional pair-aware cuts: don't orphan tool rows without their assistant tool_calls
 *  - protectRecent: last K messages always retained
 */

function messageChars(msg) {
  if (!msg) return 0;
  if (typeof msg.content === "string") return msg.content.length;
  if (Array.isArray(msg.content)) {
    return msg.content.reduce((n, p) => n + (p?.text?.length || 0), 0);
  }
  if (msg.tool_calls) return JSON.stringify(msg.tool_calls).length;
  return 0;
}

/**
 * Split leading system message(s) from the rest.
 * Only a single leading system block is treated as the protected prefix.
 */
export function splitPrefix(messages) {
  if (!messages?.length) return { prefix: [], rest: [] };
  if (messages[0]?.role === "system") {
    return { prefix: [messages[0]], rest: messages.slice(1) };
  }
  return { prefix: [], rest: [...messages] };
}

/**
 * Group rest messages into "units" for cleaner sliding:
 *  - user message alone
 *  - assistant (no tools) alone
 *  - assistant(with tool_calls) + following tool messages for those ids
 *  - orphan tool / other → alone
 */
export function groupIntoUnits(rest) {
  const units = [];
  let i = 0;
  while (i < rest.length) {
    const m = rest[i];
    if (m.role === "assistant" && Array.isArray(m.tool_calls) && m.tool_calls.length) {
      const ids = new Set(m.tool_calls.map((tc) => tc.id).filter(Boolean));
      const group = [m];
      let j = i + 1;
      while (j < rest.length && rest[j].role === "tool") {
        if (ids.size && rest[j].tool_call_id && !ids.has(rest[j].tool_call_id)) break;
        group.push(rest[j]);
        j++;
      }
      units.push({ type: "tool_turn", messages: group, chars: sumChars(group) });
      i = j;
      continue;
    }
    units.push({ type: m.role || "other", messages: [m], chars: messageChars(m) });
    i++;
  }
  return units;
}

function sumChars(msgs) {
  return msgs.reduce((n, m) => n + messageChars(m), 0);
}

function flattenUnits(units) {
  return units.flatMap((u) => u.messages);
}

/**
 * Core sliding window over non-prefix messages.
 *
 * @param {object[]} messages full transcript including system
 * @param {object} opts
 * @param {number} [opts.maxMessages=40] max messages in rest (after prefix)
 * @param {number} [opts.maxChars] optional char budget for rest
 * @param {number} [opts.protectRecent=4] newest messages always kept
 * @param {boolean} [opts.pairAware=true] drop assistant+tool units together
 * @param {boolean} [opts.insertSummary=true] inject a brief notice when drops happen
 */
export function slidingWindowEvict(messages, opts = {}) {
  const maxMessages = opts.maxMessages ?? 40;
  const maxChars = opts.maxChars ?? null;
  const protectRecent = opts.protectRecent ?? 4;
  const pairAware = opts.pairAware !== false;
  const insertSummary = opts.insertSummary !== false;

  const actions = [];
  const { prefix, rest } = splitPrefix(messages);

  if (rest.length <= maxMessages && (maxChars == null || sumChars(rest) <= maxChars)) {
    return {
      messages: [...prefix, ...rest],
      report: {
        policy: "sliding_window",
        actions: [],
        kept: rest.length,
        dropped: 0,
        totalChars: sumChars(prefix) + sumChars(rest),
      },
    };
  }

  let keptRest;
  if (pairAware) {
    const units = groupIntoUnits(rest);
    const result = slideUnits(units, { maxMessages, maxChars, protectRecent });
    keptRest = flattenUnits(result.keptUnits);
    for (const u of result.droppedUnits) {
      for (const m of u.messages) {
        actions.push({
          type: "drop",
          role: m.role,
          chars: messageChars(m),
          unit: u.type,
          tool_call_id: m.tool_call_id,
        });
      }
    }
  } else {
    // Simple tail keep
    const keepCount = Math.max(protectRecent, Math.min(maxMessages, rest.length));
    let start = Math.max(0, rest.length - keepCount);
    if (maxChars != null) {
      // grow from end until char budget
      let acc = 0;
      start = rest.length;
      for (let i = rest.length - 1; i >= 0; i--) {
        acc += messageChars(rest[i]);
        if (rest.length - i > maxMessages) break;
        if (acc > maxChars && rest.length - i >= protectRecent) break;
        start = i;
      }
    }
    const dropped = rest.slice(0, start);
    keptRest = rest.slice(start);
    for (const m of dropped) {
      actions.push({ type: "drop", role: m.role, chars: messageChars(m) });
    }
  }

  // Safety: always keep at least protectRecent if available
  if (keptRest.length < protectRecent && rest.length >= protectRecent) {
    keptRest = rest.slice(-protectRecent);
  }

  if (insertSummary && actions.length) {
    const droppedChars = actions.reduce((n, a) => n + (a.chars || 0), 0);
    const notice = {
      role: "user",
      content: `[XClaw sliding_window] Evicted ${actions.length} earlier messages (~${droppedChars} chars) to fit the context window. System prefix preserved.`,
    };
    // Place notice just after prefix, before kept rest
    keptRest = [notice, ...keptRest];
    actions.push({ type: "notice", chars: messageChars(notice) });
  }

  const out = [...prefix, ...keptRest];
  return {
    messages: out,
    report: {
      policy: "sliding_window",
      pairAware,
      actions,
      kept: keptRest.length,
      dropped: actions.filter((a) => a.type === "drop").length,
      totalChars: sumChars(out),
      messageCount: out.length,
    },
  };
}

/**
 * Slide units from the front until constraints satisfied.
 */
function slideUnits(units, { maxMessages, maxChars, protectRecent }) {
  let keptUnits = [...units];

  const msgCount = (us) => us.reduce((n, u) => n + u.messages.length, 0);
  const charCount = (us) => us.reduce((n, u) => n + u.chars, 0);
  const recentMsgCount = (us) => {
    let n = 0;
    for (let i = us.length - 1; i >= 0 && n < protectRecent; i--) {
      n += us[i].messages.length;
    }
    return n;
  };

  const droppedUnits = [];

  while (keptUnits.length > 0) {
    const overMsgs = msgCount(keptUnits) > maxMessages;
    const overChars = maxChars != null && charCount(keptUnits) > maxChars;
    if (!overMsgs && !overChars) break;

    // Don't drop if remaining messages would fall below protectRecent
    if (msgCount(keptUnits) <= protectRecent) break;

    // Drop oldest unit if that still leaves protectRecent messages
    const next = keptUnits.slice(1);
    if (msgCount(next) < protectRecent && msgCount(keptUnits) >= protectRecent) {
      // Try dropping only if unit is larger than needed — otherwise stop
      break;
    }
    droppedUnits.push(keptUnits[0]);
    keptUnits = next;
  }

  return { keptUnits, droppedUnits };
}

/**
 * Convenience: apply sliding window using cfg.tokens.eviction fields.
 */
export function slidingWindowFromConfig(messages, cfg = {}) {
  const e = cfg.tokens?.eviction || {};
  return slidingWindowEvict(messages, {
    maxMessages: e.maxMessages ?? 40,
    maxChars: e.maxChars ?? null,
    protectRecent: e.protectRecent ?? 4,
    pairAware: e.pairAware !== false,
    insertSummary: e.insertSummary !== false,
  });
}
