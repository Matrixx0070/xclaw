/**
 * Channel command router — /job, /approve, /queue, /help extensions.
 */
import { runJob } from "../jobs/job.mjs";
import { getSharedApprovalGate } from "../security/approvals.mjs";
import { enqueueJob, listQueue, queueStats } from "../jobs/queue.mjs";
import { resumeJobFromCheckpoint, listCheckpoints } from "../jobs/checkpoint.mjs";

/**
 * @returns {{ handled: boolean, reply?: string }}
 */
export async function handleChannelCommand({
  text,
  cfg,
  workingDir,
  onEvent,
  channel = "channel",
  userId = null,
  chatId = null,
  isDm = null,
}) {
  const raw = String(text || "").trim();
  if (!raw.startsWith("/")) return { handled: false };

  const [cmd, ...rest] = raw.split(/\s+/);
  const arg = rest.join(" ").trim();
  const c = cmd.toLowerCase();

  // Per-channel command allowlist (Phase J)
  const chConf = cfg?.channels?.[channel] || cfg?.channels || {};
  const allowed = chConf.allowedCommands || cfg?.channels?.allowedCommands || null;
  if (Array.isArray(allowed) && allowed.length) {
    const ok = allowed.map((x) => String(x).toLowerCase()).includes(c);
    if (!ok) {
      return { handled: true, reply: `Command ${c} not allowed on this channel.` };
    }
  }

  if (c === "/help" || c === "/start") {
    return {
      handled: true,
      reply: [
        "XClaw commands:",
        "/job <goal> — run verified job mode",
        "/seat — seat budget status",
        "/queue <goal> — enqueue background job",
        "/queue-status — queue counts",
        "/approve <id> — approve pending tool",
        "/deny <id> — deny pending tool",
        "/pending — list pending approvals",
        "/trust <30m|2h|off|status> — bounded auto-run window (critical still asks)",
        "/resume <jobId> — resume from checkpoint",
        "/status — channel health",
        "/session — session info",
        "/link — get pairing code (link accounts across channels)",
        "/link <CODE> — redeem pairing code from another channel",
        "/link status — show linked identities",
        "/unlink — unlink this channel identity",
      ].join("\n"),
    };
  }


  if (c === "/link") {
    const {
      createPairingCode,
      consumePairingCode,
      pairingStatus,
      unlinkIdentity,
      normalizeChannelUserId,
    } = await import("../connected/account-links.mjs");

    if (!userId) {
      return {
        handled: true,
        reply: "Cannot link: no user id on this message (try DMing the bot).",
      };
    }

    const sub = (arg || "").trim();
    const subLower = sub.toLowerCase();
    // R3: issue/redeem codes only in DMs
    const linkDmOnly =
      cfg?.security?.linkDmOnly !== false && cfg?.channels?.linkDmOnly !== false;
    const isStatusOrHelp = subLower === "status" || subLower === "help";
    const dm =
      isDm === true ||
      (isDm !== false &&
        chatId != null &&
        userId != null &&
        String(chatId) === String(userId));
    if (linkDmOnly && !dm && !isStatusOrHelp) {
      return {
        handled: true,
        reply:
          "For safety, /link (issue or redeem codes) only works in a **DM** with the bot — not in group channels.\nOpen a private chat and run /link there. /link status works here.",
      };
    }

    if (sub.toLowerCase() === "help") {
      return {
        handled: true,
        reply: [
          "Link accounts across channels (shared OAuth vault):",
          "1. Here: /link",
          "2. On the other channel: /link XCLAW-XXXX",
          "Also: /link status · /unlink",
        ].join("\n"),
      };
    }
    if (sub.toLowerCase() === "status") {
      const st = await pairingStatus(cfg, { channel, userId });
      return {
        handled: true,
        reply: st.linked
          ? `Linked as ${st.accountId}\nIdentities:\n` + st.identities.map((i) => `• ${i}`).join("\n")
          : `Not linked yet.\nYour identity: ${st.identity}\nRun /link to get a code.`,
      };
    }

    // Redeem code
    if (/^XCLAW-/i.test(sub) || /^[A-Z0-9]{4,8}$/i.test(sub)) {
      const code = /^XCLAW-/i.test(sub) ? sub : `XCLAW-${sub}`;
      const out = await consumePairingCode(cfg, code, { channel, userId });
      if (!out.ok) {
        return { handled: true, reply: `Link failed: ${out.error}` };
      }
      return {
        handled: true,
        reply: [
          "Accounts linked.",
          `Account: ${out.accountId}`,
          `Identities: ${(out.identities || []).join(", ")}`,
          "OAuth tokens will be shared across these channels.",
        ].join("\n"),
      };
    }

    // Issue new code
    const issued = await createPairingCode(cfg, { channel, userId });
    if (!issued.ok) {
      return { handled: true, reply: `Link failed: ${issued.error}` };
    }
    return {
      handled: true,
      reply: [
        `Pairing code: ${issued.code}`,
        `Expires in ${issued.expiresInSec}s`,
        `Your identity: ${issued.identity}`,
        "",
        "On your other channel (Telegram/Slack/Discord), send:",
        `/link ${issued.code}`,
      ].join("\n"),
    };
  }

  if (c === "/unlink") {
    if (!userId) {
      return { handled: true, reply: "Cannot unlink: no user id." };
    }
    const { unlinkIdentity, normalizeChannelUserId } = await import("../connected/account-links.mjs");
    const identity = normalizeChannelUserId({ channel, userId });
    const out = await unlinkIdentity(cfg, identity);
    return {
      handled: true,
      reply: out.deleted
        ? `Unlinked ${identity}` + (out.accountId ? ` from ${out.accountId}` : "")
        : `${identity} was not linked.`,
    };
  }

  if (c === "/seat") {
    try {
      const { listSeatsStatus, seatsEnabled } = await import("../seats/manager.mjs");
      if (!seatsEnabled(cfg)) return { handled: true, reply: "Seats disabled (set seats.enabled: true)" };
      const st = await listSeatsStatus(cfg);
      const lines = st.seats.map(
        (s) =>
          `• ${s.label}: $${(s.spentUsd || 0).toFixed(4)}/$${s.dailyUsd} · tokens ${s.tokens}/${s.dailyTokens}` +
          (s.paused ? " (paused)" : "")
      );
      return { handled: true, reply: `Seats ${st.day}\n` + (lines.join("\n") || "(none)") };
    } catch (err) {
      return { handled: true, reply: `seat error: ${err.message}` };
    }
  }
  if (c === "/job") {
    if (!arg) return { handled: true, reply: "Usage: /job <goal>" };
    try {
      const job = await runJob({
        goal: arg,
        cfg: {
          ...cfg,
          security: { ...cfg.security, autoApprove: cfg.security?.autoApprove ?? false },
        },
        workspace: workingDir,
        maxTurns: cfg.agent?.maxTurns || 12,
        autoApprove: Boolean(cfg.security?.autoApprove),
        onEvent,
      });
      const lines = [
        `Job ${job.id}: ${job.pass ? "PASS" : "FAIL"} (${job.status})`,
        `turns=${job.turns} tools=${job.toolCalls} wall=${job.wallMs}ms`,
        job.text ? String(job.text).slice(0, 1500) : "",
        job.error ? `error: ${job.error}` : "",
        job.proposal ? `skill proposal: ${job.proposal}` : "",
      ].filter(Boolean);
      return { handled: true, reply: lines.join("\n") };
    } catch (err) {
      return { handled: true, reply: `Job error: ${err.message}` };
    }
  }

  if (c === "/queue") {
    if (!arg) return { handled: true, reply: "Usage: /queue <goal>" };
    const item = await enqueueJob(cfg, { goal: arg });
    return { handled: true, reply: `Queued ${item.id}: ${arg.slice(0, 200)}` };
  }

  if (c === "/queue-status" || c === "/qstat") {
    const s = await queueStats(cfg);
    return {
      handled: true,
      reply: `queue queued=${s.queued} running=${s.running} failed=${s.failed} dead=${s.deadLetter} paused=${s.worker?.paused}`,
    };
  }

  if (c === "/pending") {
    const gate = getSharedApprovalGate(cfg);
    const list = gate.listPending();
    if (!list.length) return { handled: true, reply: "No pending approvals." };
    return {
      handled: true,
      reply: list
        .map((p) => `${p.id}  ${p.tool}  ${JSON.stringify(p.args || {}).slice(0, 80)}`)
        .join("\n"),
    };
  }

  if (c === "/approve" || c === "/deny") {
    if (!arg) return { handled: true, reply: `Usage: ${c} <pendingId>` };
    const gate = getSharedApprovalGate(cfg);
    const r = gate.decide(arg.trim(), c === "/approve", `${channel} ${c}`);
    return {
      handled: true,
      reply: r.ok ? `${c === "/approve" ? "Approved" : "Denied"} ${arg}` : `Failed: ${r.error}`,
    };
  }

  if (c === "/trust") {
    // Owner-granted bounded trust window (live-observed approval storm: 52
    // inline Allow taps in one 30-min audit session). Raises the auto-approve
    // ceiling to "risky" for a bounded time; critical ALWAYS still pends.
    const gate = getSharedApprovalGate(cfg);
    const a = arg.toLowerCase();
    if (!a || a === "status") {
      const t = gate.activeTrustWindow?.();
      return {
        handled: true,
        reply: t
          ? `Trust window ACTIVE: ≤${t.maxTier} auto-runs until ${new Date(t.expiresAt).toISOString()} (critical still asks). /trust off to end.`
          : "No trust window. /trust 30m grants ≤risky auto-run for 30 minutes (max 4h; critical always asks).",
      };
    }
    if (a === "off" || a === "stop" || a === "end") {
      const r = gate.clearTrustWindow?.(`${channel}:${userId || chatId || "owner"}`);
      return { handled: true, reply: r?.cleared ? "Trust window ended." : "No trust window was active." };
    }
    const m = a.match(/^(\d+)\s*(m|min|h|hr)?$/);
    if (!m) return { handled: true, reply: "Usage: /trust <minutes|Nh|off|status> — e.g. /trust 30m" };
    const n = Number(m[1]);
    const ttlMs = (m[2] === "h" || m[2] === "hr" ? n * 60 : n) * 60_000;
    const t = gate.setTrustWindow?.({ ttlMs, by: `${channel}:${userId || chatId || "owner"}` });
    return {
      handled: true,
      reply: `Trust window set: ≤${t.maxTier} auto-runs until ${new Date(t.expiresAt).toISOString()} (critical still asks). /trust off to end early.`,
    };
  }

  if (c === "/resume") {
    if (!arg) return { handled: true, reply: "Usage: /resume <jobId>" };
    try {
      const out = await resumeJobFromCheckpoint(cfg, arg.trim(), { onEvent });
      return {
        handled: true,
        reply: `Resume ${out.id}: ${out.pass ? "PASS" : out.status} turns=${out.turns}`,
      };
    } catch (err) {
      return { handled: true, reply: `Resume error: ${err.message}` };
    }
  }

  if (c === "/checkpoints") {
    const list = await listCheckpoints(cfg, { limit: 10 });
    if (!list.length) return { handled: true, reply: "No checkpoints." };
    return {
      handled: true,
      reply: list.map((x) => `${x.id} ${x.status} ${x.goal?.slice(0, 40)}`).join("\n"),
    };
  }

  return { handled: false };
}
