/**
 * Email channel — minimal IMAP poll + SMTP send (pure Node, no deps).
 *
 * Config (cfg.channels.email):
 *   enabled: boolean
 *   imap: { host, port=993, user, pass, tls=true, mailbox=INBOX }
 *   smtp: { host, port=465, user, pass, tls=true, from }
 *   pollIntervalMs?: number
 *   allowFrom?: string[]   // if set, only these senders
 *   workingDir?: string
 *
 * Env fallbacks: EMAIL_IMAP_HOST, EMAIL_IMAP_USER, EMAIL_IMAP_PASS,
 *   EMAIL_SMTP_HOST, EMAIL_SMTP_USER, EMAIL_SMTP_PASS, EMAIL_FROM
 */
import net from "node:net";
import tls from "node:tls";
import { replyWithAgent, truncate } from "../base.mjs";
import { processInbound, fromEmailMessage } from "../runtime.mjs";
import { workspaceForChat, isEmailSenderAllowed, extractSenderAddress } from "../policy.mjs";
import { resolveBinding, touchSession } from "../../sessions/router.mjs";
import { createRateLimiter } from "../rate-limit.mjs";

function envConf(conf) {
  return {
    enabled: conf.enabled === true,
    pollIntervalMs: Math.max(5000, Number(conf.pollIntervalMs) || 30000),
    allowFrom: Array.isArray(conf.allowFrom) ? conf.allowFrom.map((s) => s.toLowerCase()) : null,
    workingDir: conf.workingDir,
    imap: {
      host: conf.imap?.host || process.env.EMAIL_IMAP_HOST || "",
      port: Number(conf.imap?.port || process.env.EMAIL_IMAP_PORT || 993),
      user: conf.imap?.user || process.env.EMAIL_IMAP_USER || "",
      pass: conf.imap?.pass || process.env.EMAIL_IMAP_PASS || "",
      tls: conf.imap?.tls !== false,
      mailbox: conf.imap?.mailbox || "INBOX",
    },
    smtp: {
      host: conf.smtp?.host || process.env.EMAIL_SMTP_HOST || "",
      port: Number(conf.smtp?.port || process.env.EMAIL_SMTP_PORT || 465),
      user: conf.smtp?.user || process.env.EMAIL_SMTP_USER || "",
      pass: conf.smtp?.pass || process.env.EMAIL_SMTP_PASS || "",
      tls: conf.smtp?.tls !== false,
      from: conf.smtp?.from || process.env.EMAIL_FROM || "",
    },
  };
}

function connectSocket({ host, port, useTls }) {
  return new Promise((resolve, reject) => {
    const sock = useTls
      ? tls.connect({ host, port, servername: host }, () => resolve(sock))
      : net.connect({ host, port }, () => resolve(sock));
    sock.setEncoding("utf8");
    sock.on("error", reject);
  });
}

class LineSocket {
  constructor(sock) {
    this.sock = sock;
    this.buf = "";
    this.queue = [];
    this.waiters = [];
    sock.on("data", (d) => {
      this.buf += d;
      let idx;
      while ((idx = this.buf.indexOf("\r\n")) >= 0) {
        const line = this.buf.slice(0, idx);
        this.buf = this.buf.slice(idx + 2);
        if (this.waiters.length) this.waiters.shift()(line);
        else this.queue.push(line);
      }
    });
  }
  readLine(timeoutMs = 30000) {
    if (this.queue.length) return Promise.resolve(this.queue.shift());
    return new Promise((resolve, reject) => {
      const t = setTimeout(() => reject(new Error("socket read timeout")), timeoutMs);
      this.waiters.push((line) => {
        clearTimeout(t);
        resolve(line);
      });
    });
  }
  write(s) {
    this.sock.write(s);
  }
  end() {
    this.sock.end();
  }
}

async function smtpSend({ smtp, to, subject, body, inReplyTo }) {
  const from = smtp.from || smtp.user;
  if (!smtp.host || !from || !to) throw new Error("smtp incomplete");
  const sock = await connectSocket({ host: smtp.host, port: smtp.port, useTls: smtp.tls });
  const ls = new LineSocket(sock);
  const expect = async (code) => {
    const line = await ls.readLine();
    if (!line.startsWith(String(code))) throw new Error(`SMTP expected ${code} got ${line}`);
    // consume multi-line
    while (line[3] === "-" || false) break;
    return line;
  };
  await expect(220);
  ls.write(`EHLO xclaw.local\r\n`);
  // read until 250 ... without -
  let line = await ls.readLine();
  while (line.startsWith("250-")) line = await ls.readLine();
  if (!line.startsWith("250")) throw new Error(`EHLO failed: ${line}`);
  if (smtp.user) {
    ls.write(`AUTH LOGIN\r\n`);
    await expect(334);
    ls.write(Buffer.from(smtp.user).toString("base64") + "\r\n");
    await expect(334);
    ls.write(Buffer.from(smtp.pass).toString("base64") + "\r\n");
    await expect(235);
  }
  ls.write(`MAIL FROM:<${from}>\r\n`);
  await expect(250);
  ls.write(`RCPT TO:<${to}>\r\n`);
  await expect(250);
  ls.write(`DATA\r\n`);
  await expect(354);
  const headers = [
    `From: ${from}`,
    `To: ${to}`,
    `Subject: ${subject || "XClaw reply"}`,
    `MIME-Version: 1.0`,
    `Content-Type: text/plain; charset=utf-8`,
  ];
  if (inReplyTo) headers.push(`In-Reply-To: ${inReplyTo}`, `References: ${inReplyTo}`);
  const payload =
    headers.join("\r\n") + "\r\n\r\n" + String(body || "").replace(/^\./gm, "..") + "\r\n.\r\n";
  ls.write(payload);
  await expect(250);
  ls.write(`QUIT\r\n`);
  ls.end();
}

async function imapFetchUnseen({ imap }) {
  if (!imap.host || !imap.user) throw new Error("imap incomplete");
  const sock = await connectSocket({ host: imap.host, port: imap.port, useTls: imap.tls });
  const ls = new LineSocket(sock);
  const tag = () => `A${Math.floor(Math.random() * 1e6)}`;
  const cmd = async (c) => {
    const t = tag();
    ls.write(`${t} ${c}\r\n`);
    const lines = [];
    while (true) {
      const line = await ls.readLine(60000);
      lines.push(line);
      if (line.startsWith(t + " ")) break;
    }
    const last = lines[lines.length - 1];
    if (!last.includes("OK")) throw new Error(`IMAP ${c}: ${last}`);
    return lines;
  };
  // greeting
  await ls.readLine();
  await cmd(`LOGIN "${imap.user.replace(/"/g, '\\"')}" "${imap.pass.replace(/"/g, '\\"')}"`);
  await cmd(`SELECT ${imap.mailbox || "INBOX"}`);
  const searchLines = await cmd(`SEARCH UNSEEN`);
  const searchLine = searchLines.find((l) => l.startsWith("* SEARCH")) || "";
  const ids = searchLine
    .replace("* SEARCH", "")
    .trim()
    .split(/\s+/)
    .filter((x) => /^\d+$/.test(x));
  const messages = [];
  for (const id of ids.slice(0, 10)) {
    const lines = await cmd(`FETCH ${id} (BODY.PEEK[HEADER.FIELDS (FROM SUBJECT MESSAGE-ID)] BODY.PEEK[TEXT])`);
    const blob = lines.join("\n");
    const fromM = blob.match(/From:\s*(.+)/i);
    const subM = blob.match(/Subject:\s*(.+)/i);
    const midM = blob.match(/Message-ID:\s*(.+)/i);
    // crude text body: after first blank following TEXT
    let text = "";
    const textIdx = blob.search(/BODY\[TEXT\]/i);
    if (textIdx >= 0) {
      const after = blob.slice(textIdx);
      const m = after.match(/\{(\d+)\}/);
      // fallback: take last non-tag lines
      text = lines
        .filter((l) => !l.startsWith("*") && !l.startsWith("A"))
        .join("\n")
        .slice(0, 8000);
    }
    messages.push({
      id,
      from: (fromM?.[1] || "").trim(),
      subject: (subM?.[1] || "").trim(),
      messageId: (midM?.[1] || "").trim(),
      text: text.trim() || "(no text body parsed)",
    });
    await cmd(`STORE ${id} +FLAGS (\\Seen)`).catch(() => {});
  }
  await cmd("LOGOUT").catch(() => {});
  ls.end();
  return messages;
}

export function createEmailChannel(cfg) {
  const conf = envConf(cfg.channels?.email || {});
  const enabled = Boolean(
    conf.enabled &&
      conf.imap.host &&
      conf.imap.user &&
      conf.smtp.host &&
      (conf.smtp.from || conf.smtp.user)
  );
  const rateLimiter = createRateLimiter(cfg.channels?.rateLimit || {});
  let stopped = false;
  let loopPromise = null;
  let messagesHandled = 0;
  let lastError = null;
  let lastOkAt = null;
  let loopAlive = false;

  async function handleMail(mail) {
    const fromAddr = extractSenderAddress(mail.from);
    if (!isEmailSenderAllowed(conf.allowFrom, fromAddr)) {
      console.log(`[email] skip sender ${fromAddr}`);
      return;
    }
    const session = resolveBinding("email", fromAddr, "dm");
    touchSession(session.id);
    const workspace =
      session.workingDir ||
      workspaceForChat(cfg, "email", fromAddr, conf.workingDir) ||
      process.cwd();
    const text = `Subject: ${mail.subject}\nFrom: ${mail.from}\n\n${mail.text}`;
    const rl = rateLimiter.allow(`email:${fromAddr}`);
    if (!rl.ok) return;

    console.log(`[email] ← ${fromAddr}: ${mail.subject}`);
    try {
      const inbound = fromEmailMessage({
        from: fromAddr,
        subject: mail.subject,
        text: mail.text,
      });
      inbound.text = text;
      const out = await processInbound(inbound, {
        cfg,
        workingDir: workspace,
        rateLimiter,
        // Same auto-promote as Telegram/Discord MESSAGE/Slack: shouldAutoPromoteTurn
        // is false without notify. Named chatId already persists via
        // processInbound → replyWithAgent — do not mint persistRun.
        // Gateway stays alive, so the mission is detached. Follow-ups stay
        // In-Reply-To the originating message (same as the agent reply).
        notify: async (t) => {
          const notice = String(t || "").trim();
          if (!notice) return;
          await smtpSend({
            smtp: conf.smtp,
            to: fromAddr,
            subject: mail.subject?.startsWith("Re:")
              ? mail.subject
              : `Re: ${mail.subject || "XClaw"}`,
            body: notice,
            inReplyTo: mail.messageId,
          });
          console.log(
            `[email] → ${fromAddr}: [mission] ${notice.slice(0, 60)}`
          );
        },
        onEvent: (e) => {
          if (e.type === "tool" && e.phase === "start") console.log(`[email]   → ${e.name}`);
        },
      });
      if (out.handled && out.reply) {
        await smtpSend({
          smtp: conf.smtp,
          to: fromAddr,
          subject: mail.subject?.startsWith("Re:") ? mail.subject : `Re: ${mail.subject || "XClaw"}`,
          body: truncate(out.reply, 100000),
          inReplyTo: mail.messageId,
        });
        messagesHandled += 1;
        lastOkAt = new Date().toISOString();
        lastError = null;
        console.log(`[email] → ${fromAddr}`);
      }
    } catch (err) {
      lastError = err.message || String(err);
      console.error(`[email] error:`, lastError);
    }
  }

  async function pollLoop() {
    console.log(`[email] IMAP poll ${conf.imap.host} mailbox=${conf.imap.mailbox}`);
    while (!stopped) {
      try {
        const mails = await imapFetchUnseen({ imap: conf.imap });
        for (const m of mails) await handleMail(m);
      } catch (e) {
        console.error(`[email] poll error:`, e.message);
      }
      await new Promise((r) => setTimeout(r, conf.pollIntervalMs));
    }
  }

  return {
    name: "email",
    enabled,
    // Seam: drive the real inbound handler in-process (mirrors Discord's
    // handleInbound) so the sender gate wiring — extraction → allowlist deny —
    // is testable without a live IMAP poll.
    handleMail,
    async start() {
      if (!enabled) {
        console.log("[email] disabled (need enabled + imap + smtp config)");
        return;
      }
      stopped = false;
      lastError = null;
      loopAlive = true;
      loopPromise = pollLoop();
    },
    async stop() {
      stopped = true;
      if (loopPromise) await loopPromise.catch(() => {});
    },
    status() {
      return {
        name: "email",
        enabled,
        messagesHandled,
        running: enabled && loopAlive && !stopped,
        loopAlive,
        lastError,
        lastOkAt,
        imap: conf.imap.host || null,
        smtp: conf.smtp.host || null,
      };
    },
  };
}
