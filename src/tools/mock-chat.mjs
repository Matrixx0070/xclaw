/**
 * Wave C — file-based chat/slack messages for WildClaw social tasks.
 */
import fs from "node:fs";
import path from "node:path";

function findMessages(cwd) {
  const candidates = [
    path.join(cwd, "messages.json"),
    path.join(cwd, "exec/messages.json"),
    path.join(cwd, "fixtures/slack/messages.json"),
    path.join(cwd, "exec/fixtures/slack/messages.json"),
    path.join(cwd, "tmp/messages.json"),
  ];
  try {
    for (const ent of fs.readdirSync(cwd, { withFileTypes: true })) {
      if (!ent.isDirectory()) continue;
      candidates.push(
        path.join(cwd, ent.name, "messages.json"),
        path.join(cwd, ent.name, "exec/messages.json"),
        path.join(cwd, ent.name, "exec/fixtures/slack/messages.json"),
        path.join(cwd, ent.name, "tmp/messages.json")
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

export function createMockChatTools(cwd = process.cwd()) {
  return [
    {
      name: "xclaw_chat_list",
      description:
        "List mock chat/Slack messages from WildClaw social fixtures (messages.json).",
      parameters: {
        type: "object",
        properties: {
          limit: { type: "number" },
          channel: { type: "string" },
        },
      },
      async execute(args = {}) {
        const file = findMessages(cwd);
        if (!file) return { ok: false, error: "no messages.json fixture found" };
        const raw = JSON.parse(fs.readFileSync(file, "utf8"));
        let msgs = Array.isArray(raw)
          ? raw
          : raw.messages || raw.channels || [];
        if (!Array.isArray(msgs) && typeof raw === "object") {
          // channel map
          const ch = args.channel;
          if (ch && raw[ch]) msgs = raw[ch];
          else msgs = Object.values(raw).flat().filter((x) => x && x.text);
        }
        if (!Array.isArray(msgs)) msgs = [];
        const limit = Math.min(100, Number(args.limit) || 50);
        return {
          ok: true,
          file,
          count: Math.min(msgs.length, limit),
          messages: msgs.slice(0, limit).map((m, i) => ({
            id: m.id || m.ts || String(i),
            user: m.user || m.from || m.username,
            channel: m.channel,
            text: String(m.text || m.body || "").slice(0, 500),
          })),
        };
      },
    },
  ];
}

export default { createMockChatTools };
