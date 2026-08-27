/**
 * Shared multi-channel inbound runtime (CL multi-channel).
 *
 * Normalize → commands → rate limit → replyWithAgent → outbound text.
 * Channel modules stay responsible for transport; this owns the agent path.
 */
import { replyWithAgent as defaultReplyWithAgent } from "./base.mjs";
import { handleChannelCommand as defaultHandleCommand } from "./commands.mjs";
import { normalizeChannelUserId } from "../connected/account-links.mjs";

/**
 * @typedef {object} NormalizedInbound
 * @property {string} channel - telegram|slack|discord|email|webchat
 * @property {string} text
 * @property {string|null} userId - platform-native id
 * @property {string|null} chatId
 * @property {string|null} [threadId]
 * @property {boolean} [isBot]
 * @property {string|null} [username]
 * @property {Array<{name?: string, path?: string}>} [files]
 * @property {object} [raw]
 */

/**
 * Build a stable normalized inbound message.
 * @param {Partial<NormalizedInbound> & { channel: string }} input
 * @returns {NormalizedInbound}
 */
export function normalizeInbound(input = {}) {
  const channel = String(input.channel || "unknown").toLowerCase();
  let text = String(input.text || "").trim();
  const userId =
    input.userId != null && String(input.userId).trim() !== ""
      ? String(input.userId)
      : null;
  const chatId =
    input.chatId != null && String(input.chatId).trim() !== ""
      ? String(input.chatId)
      : null;

  // Strip Slack-style bot mention if botUserId provided
  if (input.botUserId && text) {
    text = text.replace(new RegExp(`<@${input.botUserId}>`, "g"), "").trim();
  }

  const files = Array.isArray(input.files) ? input.files : [];
  const identity = normalizeChannelUserId({ channel, userId, chatId });

  let isDm = input.isDm;
  if (isDm === undefined || isDm === null) {
    isDm =
      userId != null && chatId != null && String(userId) === String(chatId);
  } else {
    isDm = Boolean(isDm);
  }

  return {
    channel,
    text,
    userId,
    chatId,
    threadId: input.threadId || null,
    isDm,
    isBot: Boolean(input.isBot),
    username: input.username || null,
    files,
    identity,
    raw: input.raw || null,
  };
}

/**
 * Fixtures: convert platform-shaped events into NormalizedInbound.
 */
export function fromSlackMessage(msg, { channelId, botUserId } = {}) {
  const chId = channelId || msg?.channel || null;
  return normalizeInbound({
    channel: "slack",
    text: msg?.text || "",
    userId: msg?.user || null,
    chatId: chId,
    threadId: msg?.thread_ts || msg?.ts || null,
    isDm: Boolean(chId && String(chId).startsWith("D")),
    isBot: Boolean(msg?.bot_id || msg?.subtype === "bot_message"),
    files: Array.isArray(msg?.files)
      ? msg.files.map((f) => ({ name: f.name || f.id, path: null }))
      : [],
    botUserId,
    raw: msg,
  });
}

export function fromSlackAppMention(event, { botUserId } = {}) {
  return normalizeInbound({
    channel: "slack",
    text: event?.text || "",
    userId: event?.user || null,
    chatId: event?.channel || null,
    threadId: event?.thread_ts || event?.ts || null,
    isBot: false,
    botUserId,
    raw: event,
  });
}

export function fromTelegramUpdate(update) {
  const msg = update?.message || update?.edited_message || {};
  const chatId = msg.chat?.id != null ? String(msg.chat.id) : null;
  const userId = msg.from?.id != null ? String(msg.from.id) : chatId;
  const chatType = msg.chat?.type || "private";
  return normalizeInbound({
    channel: "telegram",
    text: msg.text || msg.caption || "",
    userId,
    chatId,
    threadId: msg.message_id != null ? String(msg.message_id) : null,
    isDm: chatType === "private",
    isBot: Boolean(msg.from?.is_bot),
    username: msg.from?.username || null,
    files: msg.photo || msg.document ? [{ name: "attachment" }] : [],
    raw: update,
  });
}

export function fromDiscordMessage(msg) {
  return normalizeInbound({
    channel: "discord",
    text: msg?.content || "",
    userId: msg?.author?.id != null ? String(msg.author.id) : null,
    chatId: msg?.channel_id != null ? String(msg.channel_id) : null,
    threadId: msg?.id != null ? String(msg.id) : null,
    isDm: msg?.guild_id == null && msg?.guildId == null,
    isBot: Boolean(msg?.author?.bot),
    username: msg?.author?.username || null,
    files: Array.isArray(msg?.attachments)
      ? msg.attachments.map((a) => ({ name: a.filename || a.id }))
      : [],
    raw: msg,
  });
}

export function fromEmailMessage(mail) {
  const from = String(mail?.from || mail?.fromAddress || "").trim();
  const subject = String(mail?.subject || "").trim();
  const body = String(mail?.text || mail?.body || "").trim();
  const text = [subject && `Subject: ${subject}`, body].filter(Boolean).join("\n\n");
  return normalizeInbound({
    channel: "email",
    text,
    userId: from || null,
    chatId: from || null,
    isDm: true,
    username: from || null,
    raw: mail,
  });
}

export function fromWebChatMessage({ message, sessionId, userId } = {}) {
  return normalizeInbound({
    channel: "webchat",
    text: message || "",
    userId: userId || sessionId || null,
    chatId: sessionId || null,
    raw: { message, sessionId },
  });
}

/**
 * Process one normalized inbound message through the shared agent path.
 *
 * @param {NormalizedInbound} inbound
 * @param {object} opts
 * @param {object} opts.cfg
 * @param {string} [opts.workingDir]
 * @param {Function} [opts.replyWithAgent]
 * @param {Function} [opts.handleCommand]
 * @param {{ allow: (key: string) => { ok: boolean } }} [opts.rateLimiter]
 * @param {Function} [opts.onEvent]
 * @returns {Promise<{
 *   handled: boolean,
 *   skipped?: string,
 *   reply?: string,
 *   via?: string,
 *   identity?: string,
 *   userId?: string|null,
 * }>}
 */
export async function processInbound(inbound, opts = {}) {
  const {
    cfg = {},
    workingDir = process.cwd(),
    replyWithAgent = defaultReplyWithAgent,
    handleCommand = defaultHandleCommand,
    rateLimiter = null,
    onEvent,
  } = opts;

  if (!inbound || inbound.isBot) {
    return { handled: false, skipped: "bot" };
  }

  let text = inbound.text || "";
  if (inbound.files?.length) {
    for (const f of inbound.files) {
      if (f.path) text += `\n\n[Attached file saved to ${f.path}]`;
      else if (f.name) text += `\n\n[Attachment: ${f.name}]`;
    }
    text = text.trim();
  }
  if (!text) return { handled: false, skipped: "empty" };

  // Slash commands
  if (text.startsWith("/")) {
    const cmd = await handleCommand({
      text,
      cfg,
      workingDir,
      channel: inbound.channel,
      userId: inbound.userId,
      chatId: inbound.chatId,
      isDm: inbound.isDm,
      onEvent,
    });
    if (cmd.handled) {
      return {
        handled: true,
        via: "command",
        reply: cmd.reply || "OK",
        identity: inbound.identity,
        userId: inbound.userId,
      };
    }
  }

  if (rateLimiter) {
    const key = `${inbound.channel}:${inbound.chatId || ""}:${inbound.userId || ""}`;
    const rl = rateLimiter.allow(key);
    if (!rl.ok) {
      return {
        handled: true,
        via: "rate_limit",
        code: "RATE_LIMITED",
        reply: "Rate limit — try again shortly.",
        retryAfterMs: rl.retryAfterMs ?? null,
        identity: inbound.identity,
      };
    }
  }

  // ── Long-run objective routing (mission survives execution boundaries) ──
  // A channel message may (a) command the objective system, (b) answer an
  // escalated question, or (c) arrive while a mission runs. Everything else
  // is a normal turn — which can auto-promote into a mission when the turn
  // cap truncates it (the traced "asks after ~20-30 tool calls" failure).
  const objectivesEnabled = cfg.objectives?.enabled !== false;
  if (objectivesEnabled) {
    try {
      const routed = await routeObjective({
        text,
        inbound,
        cfg,
        workingDir,
        replyWithAgent,
        onEvent,
        notify: opts.notify || null,
      });
      if (routed) return routed;
    } catch (err) {
      onEvent?.({ type: "objective", phase: "route_error", message: String(err?.message || err) });
    }
  }

  const result = await replyWithAgent({
    cfg,
    message: text,
    workingDir,
    userId: inbound.userId,
    channel: inbound.channel,
    chatId: inbound.chatId,
    onEvent,
    stream: opts.stream === true,
    ...(opts.channelContext ? { channelContext: opts.channelContext } : {}),
  });

  // Auto-promotion: the run was CUT OFF by the turn cap mid-work — the exact
  // live failure where the agent then asked "should I continue?". Promote it
  // into a durable objective and keep going; the user sees one continuous
  // mission. Requires a channel notify sender for the detached updates.
  if (
    objectivesEnabled &&
    opts.notify &&
    result.stopReason === "maxTurns" &&
    cfg.objectives?.autoPromote !== false
  ) {
    try {
      const promo = await promoteTurnToObjective({
        text,
        inbound,
        cfg,
        workingDir,
        replyWithAgent,
        onEvent,
        notify: opts.notify,
        turnResult: result,
      });
      if (promo) {
        return {
          handled: true,
          via: "objective_promoted",
          reply:
            `${result.text || ""}\n\n🎯 I hit this segment's execution budget mid-task — continuing autonomously as mission \`${promo.id}\`. ` +
            `I'll report progress here; /objective status any time.`,
          identity: result.identity || inbound.identity,
          vaultUserId: result.vaultUserId,
          userId: inbound.userId,
          turns: result.turns,
          suggestions: [],
        };
      }
    } catch (err) {
      onEvent?.({ type: "objective", phase: "promote_error", message: String(err?.message || err) });
    }
  }

  return {
    handled: true,
    via: "agent",
    reply: result.text || "(no response)",
    images: result.images || [],
    identity: result.identity || inbound.identity,
    vaultUserId: result.vaultUserId,
    userId: inbound.userId,
    turns: result.turns,
    suggestions: result.suggestions || [],
  };
}

/** Build the segment runner + start a detached mission loop. */
/** Extract operator guardrail flags from a mission command tail, stripping
 * them out so the remainder is the goal/subcommand text.
 *   --deadline <ISO | +Nm | +Nh | +Nd>   --max-usd <n>   --max-tools <n>
 * Operator-set only: a mission cannot widen its own limits — raising a cap is
 * an explicit /objective resume with a new flag. */
export function parseObjectiveFlags(rest) {
  let text = String(rest || "");
  const take = (re) => {
    const m = text.match(re);
    if (!m) return null;
    text = (text.slice(0, m.index) + text.slice(m.index + m[0].length)).replace(/\s{2,}/g, " ").trim();
    return m[1];
  };
  let deadline = null;
  const dl = take(/--deadline\s+(\S+)/i);
  if (dl) {
    const rel = dl.match(/^\+(\d+)\s*([mhd])$/i);
    if (rel) {
      const mult = { m: 60000, h: 3600000, d: 86400000 }[rel[2].toLowerCase()];
      deadline = new Date(Date.now() + Number(rel[1]) * mult).toISOString();
    } else {
      deadline = dl; // ISO — normalizeDeadline validates/normalizes downstream
    }
  }
  const usd = take(/--max-usd\s+([\d.]+)/i);
  const tools = take(/--max-tools\s+(\d+)/i);
  const budget =
    usd || tools
      ? { maxUsd: usd ? Number(usd) : null, maxToolCalls: tools ? Number(tools) : null }
      : null;
  return { text: text.trim(), deadline, budget };
}

function startDetachedObjective({ cfg, workingDir, replyWithAgent, onEvent, notify, inbound, runOpts }) {
  const runSegment = async ({ prompt, rescuePrompt, sessionId }) =>
    replyWithAgent({
      cfg,
      message: prompt,
      workingDir,
      userId: inbound.userId,
      channel: inbound.channel,
      chatId: inbound.chatId,
      onEvent,
      history: [], // fresh context each segment — durable state IS the memory
      continuation: false, // objective owns segmentation — single-segment runs
      chatSessionId: sessionId,
      rescuePrompt,
    });
  const notifyFn = async (msg, meta) => {
    try {
      await notify(msg, meta || {});
    } catch {
      /* notify best-effort */
    }
  };
  import("../agent/objective.mjs")
    .then(({ runObjective }) =>
      runObjective(cfg, {
        ...runOpts,
        sessionKey: runOpts.sessionKey ?? inbound.identity ?? null,
        channel: inbound.channel,
        chatId: inbound.chatId,
        workingDir,
        runSegment,
        notify: notifyFn,
        onEvent,
      })
    )
    .catch((err) => {
      onEvent?.({ type: "objective", phase: "run_error", message: String(err?.message || err) });
      notifyFn(`⚠️ Mission runtime error: ${String(err?.message || err).slice(0, 300)}`).catch(() => {});
    });
}

/** Handle /objective commands, escalation answers, and in-flight status.
 *  Exported so non-processInbound channels (webchat) reuse the same router. */
export async function routeObjective({ text, inbound, cfg, workingDir, replyWithAgent, onEvent, notify }) {
  const store = await import("../agent/objective-store.mjs");
  const scope = { sessionKey: inbound.identity, channel: inbound.channel, chatId: inbound.chatId };
  const lower = text.trim().toLowerCase();
  const isCmd = lower.startsWith("/objective") || lower.startsWith("/mission");

  const active = await store.findActiveObjective(cfg, scope);

  if (isCmd) {
    const rawRest = text.trim().split(/\s+/).slice(1).join(" ").trim();
    const { text: rest, deadline: flagDeadline, budget: flagBudget } = parseObjectiveFlags(rawRest);
    const sub = rest.split(/\s+/)[0]?.toLowerCase() || "";
    if (!rest || sub === "status") {
      if (!active) return { handled: true, via: "objective", reply: "No active mission. /objective <goal> to start one." };
      const done = active.criteria.filter((c) => c.done).length;
      return {
        handled: true,
        via: "objective",
        reply:
          `🎯 Mission \`${active.id}\` — ${active.status}\n` +
          `Objective: ${active.objective.slice(0, 300)}\n` +
          `Segments: ${active.totals.segments} · tool calls: ${active.totals.toolCalls} · criteria: ${done}/${active.criteria.length}\n` +
          `Current: ${active.currentSubtask || "—"}` +
          (active.humanQuestion ? `\n❓ Waiting on you: ${active.humanQuestion}` : ""),
      };
    }
    if (sub === "stop") {
      if (!active) return { handled: true, via: "objective", reply: "No active mission to stop." };
      active.stopRequested = true;
      await store.saveObjective(cfg, active);
      return { handled: true, via: "objective", reply: `🛑 Stop requested for \`${active.id}\` — it will halt at the next segment boundary (state preserved).` };
    }
    if (sub === "list") {
      const all = await store.listObjectives(cfg);
      if (!all.length) return { handled: true, via: "objective", reply: "No missions recorded." };
      return {
        handled: true,
        via: "objective",
        reply: all
          .slice(0, 10)
          .map(
            (o) =>
              `${o.status === "running" ? "▶️" : o.status === "done" ? "✅" : "⏸"} \`${o.id}\` ${o.status} · seg ${o.totals.segments} · ${o.objective.slice(0, 80)}`
          )
          .join("\n") + "\n\nResume any with /objective resume <id>.",
      };
    }
    if (sub === "resume") {
      // explicit id adopts the mission into THIS chat (heals objectives
      // orphaned by ephemeral webchat sessions; lets telegram adopt a
      // webchat-started mission)
      const explicitId = rest.split(/\s+/)[1] || null;
      const target = explicitId ? await store.loadObjective(cfg, explicitId) : active;
      if (!target) return { handled: true, via: "objective", reply: explicitId ? `No mission \`${explicitId}\`.` : "Nothing to resume." };
      if (!notify) return { handled: true, via: "objective", reply: "This channel cannot run detached missions (no sender)." };
      if (target.status === "running") return { handled: true, via: "objective", reply: `Mission \`${target.id}\` is already running.` };
      if (store.isTerminalObjective(target.status) && target.status !== "stopped") {
        return { handled: true, via: "objective", reply: `Mission \`${target.id}\` is ${target.status} — nothing to resume.` };
      }
      if (explicitId) {
        target.channel = inbound.channel;
        target.chatId = inbound.chatId;
        target.sessionKey = inbound.identity || target.sessionKey;
        await store.saveObjective(cfg, target);
      }
      startDetachedObjective({ cfg, workingDir, replyWithAgent, onEvent, notify, inbound, runOpts: { resumeId: target.id, deadline: flagDeadline, budget: flagBudget } });
      return { handled: true, via: "objective", reply: `▶️ Resuming mission \`${target.id}\`.` };
    }
    // /objective <goal text> — explicit mission start
    if (active && !store.isTerminalObjective(active.status)) {
      return { handled: true, via: "objective", reply: `A mission is already active (\`${active.id}\`, ${active.status}). /objective status | stop first.` };
    }
    if (!notify) return { handled: true, via: "objective", reply: "This channel cannot run detached missions (no sender)." };
    startDetachedObjective({ cfg, workingDir, replyWithAgent, onEvent, notify, inbound, runOpts: { objective: rest, deadline: flagDeadline, budget: flagBudget } });
    return { handled: true, via: "objective", reply: `🎯 Mission started. I'll work autonomously and report here; /objective status any time.` };
  }

  if (!active) return null;

  if (active.status === "awaiting_human") {
    if (!notify) return null;
    startDetachedObjective({ cfg, workingDir, replyWithAgent, onEvent, notify, inbound, runOpts: { resumeId: active.id, answer: text } });
    return { handled: true, via: "objective", reply: `▶️ Got it — resuming mission \`${active.id}\` with your answer.` };
  }
  if (active.status === "running") {
    return {
      handled: true,
      via: "objective",
      reply: `⏳ Mission \`${active.id}\` is running (segment ${active.totals.segments}, ${active.totals.toolCalls} tool calls). /objective status | stop. (Your message was not treated as a new task.)`,
    };
  }
  if (active.status === "interrupted" || active.status === "paused_budget") {
    if (notify) {
      startDetachedObjective({ cfg, workingDir, replyWithAgent, onEvent, notify, inbound, runOpts: { resumeId: active.id } });
      return { handled: true, via: "objective", reply: `▶️ Mission \`${active.id}\` was ${active.status.replace("_", " ")} — resuming it now (your message noted). /objective stop to cancel.` };
    }
  }
  return null;
}

/** Convert a turn-cap-truncated normal turn into a seeded mission. */
/**
 * A bare affirmation ("yes", "ok", "go ahead") is a CONTINUATION, not a
 * mission title. Promoting it verbatim produced missions literally named
 * "Yes" that lost the actual task. When the inbound is such an affirmation,
 * anchor the objective in the model's own partial-work summary so the mission
 * has a real objective and the model doesn't restart blind.
 */
const AFFIRMATION_RE =
  /^(y|yes|yep|yeah|yup|ok|okay|k|sure|go|go ahead|do it|continue|proceed|please do|sounds good|👍)\b[.! ]*$/i;

export function deriveObjectiveText(text, turnResult = {}) {
  const t = String(text || "").trim();
  if (!AFFIRMATION_RE.test(t)) return t;
  const summary = String(turnResult.text || "").trim();
  const firstLine = summary
    .split("\n")
    .map((l) => l.replace(/^[#>*\-\s]+/, "").trim())
    .find((l) => l.length >= 12);
  if (!firstLine) return t;
  return `Continue the in-progress task (user approved with "${t}"): ${firstLine.slice(0, 400)}`;
}

async function promoteTurnToObjective({ text, inbound, cfg, workingDir, replyWithAgent, onEvent, notify, turnResult }) {
  const store = await import("../agent/objective-store.mjs");
  const existing = await store.findActiveObjective(cfg, {
    sessionKey: inbound.identity,
    channel: inbound.channel,
    chatId: inbound.chatId,
  });
  if (existing) return null; // never stack missions
  const files = [];
  for (const t of turnResult.toolTrace || []) {
    for (const a of t.artifacts || []) {
      if (a?.type === "file" && typeof a.ref === "string" && !files.includes(a.ref)) files.push(a.ref);
    }
  }
  const obj = store.newObjective({
    objective: deriveObjectiveText(text, turnResult),
    sessionKey: inbound.identity,
    channel: inbound.channel,
    chatId: inbound.chatId,
    workingDir,
  });
  store.mergeStateUpdate(obj, {
    progress: [
      `Initial turn ran ${(turnResult.toolTrace || []).length} tool calls before hitting the segment budget; its partial summary was delivered to the user.`,
    ],
    findings: turnResult.text ? [String(turnResult.text).slice(0, 800)] : [],
    inspected: { files: files.slice(0, 100) },
  });
  await store.saveObjective(cfg, obj);
  startDetachedObjective({ cfg, workingDir, replyWithAgent, onEvent, notify, inbound, runOpts: { resumeId: obj.id } });
  return { id: obj.id };
}
