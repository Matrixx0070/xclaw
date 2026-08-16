/**
 * Wave C — file-based mock Gmail for WildClaw social tasks.
 * Loads inbox.json { emails, reactive_replies } from workspace fixture.
 */
import fs from "node:fs";
import path from "node:path";

function findInbox(cwd) {
  const candidates = [
    path.join(cwd, "fixtures/gmail/inbox.json"),
    path.join(cwd, "exec/fixtures/gmail/inbox.json"),
    path.join(cwd, "gmail/inbox.json"),
  ];
  // also search one level deep
  try {
    for (const ent of fs.readdirSync(cwd, { withFileTypes: true })) {
      if (!ent.isDirectory()) continue;
      candidates.push(
        path.join(cwd, ent.name, "fixtures/gmail/inbox.json"),
        path.join(cwd, ent.name, "exec/fixtures/gmail/inbox.json")
      );
    }
  } catch {
    /* */
  }
  for (const c of candidates) {
    if (fs.existsSync(c)) return c;
  }
  return null;
}

function statePath(cwd) {
  return path.join(cwd, ".xclaw_mail_state.json");
}

function loadState(cwd) {
  const sp = statePath(cwd);
  if (fs.existsSync(sp)) {
    return JSON.parse(fs.readFileSync(sp, "utf8"));
  }
  const inboxFile = findInbox(cwd);
  if (!inboxFile) {
    return {
      emails: [],
      reactive_replies: {},
      sent: [],
      replyIndex: {},
      inboxFile: null,
    };
  }
  const data = JSON.parse(fs.readFileSync(inboxFile, "utf8"));
  const emails = Array.isArray(data.emails) ? data.emails.map((e) => ({ ...e })) : [];
  const reactive = data.reactive_replies || {};
  const replyIndex = {};
  for (const k of Object.keys(reactive)) replyIndex[k.toLowerCase()] = 0;
  return {
    emails,
    reactive_replies: reactive,
    sent: [],
    replyIndex,
    inboxFile,
  };
}

function saveState(cwd, state) {
  fs.writeFileSync(statePath(cwd), JSON.stringify(state, null, 2));
}

/**
 * @param {string} cwd
 */
export function createMockMailTools(cwd = process.cwd()) {
  return [
    {
      name: "xclaw_mail_inbox",
      description:
        "List emails in the mock inbox (WildClaw social fixtures). Returns id, from, to, subject.",
      parameters: {
        type: "object",
        properties: {
          limit: { type: "number", description: "Max messages (default 20)" },
        },
      },
      async execute(args = {}) {
        const state = loadState(cwd);
        const limit = Math.min(50, Number(args.limit) || 20);
        const list = state.emails.slice(-limit).map((e) => ({
          message_id: e.message_id || e.id,
          from: e.from,
          to: e.to,
          subject: e.subject,
          preview: String(e.body || "").slice(0, 120),
        }));
        return {
          ok: true,
          count: list.length,
          inboxFile: state.inboxFile,
          messages: list,
        };
      },
    },
    {
      name: "xclaw_mail_read",
      description: "Read a full mock email by message_id.",
      parameters: {
        type: "object",
        properties: {
          message_id: { type: "string" },
        },
        required: ["message_id"],
      },
      async execute(args = {}) {
        const state = loadState(cwd);
        const id = String(args.message_id || "");
        const msg = state.emails.find(
          (e) => String(e.message_id || e.id) === id
        );
        if (!msg) return { ok: false, error: `not found: ${id}` };
        return { ok: true, message: msg };
      },
    },
    {
      name: "xclaw_mail_send",
      description:
        "Send a mock email. May trigger scripted reactive replies from the fixture (for negotiation tasks).",
      parameters: {
        type: "object",
        properties: {
          to: { type: "string" },
          subject: { type: "string" },
          body: { type: "string" },
        },
        required: ["to", "subject", "body"],
      },
      async execute(args = {}) {
        const state = loadState(cwd);
        const to = String(args.to || "").toLowerCase();
        const sent = {
          message_id: `sent_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
          from: "me@company.com",
          to: args.to,
          subject: args.subject,
          body: args.body,
          at: new Date().toISOString(),
        };
        state.sent.push(sent);

        // inject reactive reply if any
        const key = Object.keys(state.reactive_replies || {}).find(
          (k) => k.toLowerCase() === to
        );
        let injected = null;
        if (key) {
          const queue = state.reactive_replies[key];
          const idx = state.replyIndex[key.toLowerCase()] || 0;
          if (Array.isArray(queue) && idx < queue.length) {
            const reply = { ...queue[idx] };
            if (!reply.message_id) reply.message_id = `react_${key}_${idx}`;
            state.emails.push(reply);
            state.replyIndex[key.toLowerCase()] = idx + 1;
            injected = reply.message_id;
          }
        }
        saveState(cwd, state);
        return {
          ok: true,
          sent: sent.message_id,
          reactiveInjected: injected,
        };
      },
    },
  ];
}

export default { createMockMailTools };
