/**
 * Wave C2 — HTTP client tools for WildClaw FastAPI gmail/calendar/slack mocks.
 * Defaults: gmail :9100, calendar :9101, slack :9102
 */
const GMAIL = process.env.XCLAW_MOCK_GMAIL_URL || "http://127.0.0.1:9100";
const CAL = process.env.XCLAW_MOCK_CALENDAR_URL || "http://127.0.0.1:9101";
const SLACK = process.env.XCLAW_MOCK_SLACK_URL || "http://127.0.0.1:9102";

async function post(base, path, body = {}) {
  const url = `${base}${path}`;
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    const text = await res.text();
    let data;
    try {
      data = JSON.parse(text);
    } catch {
      data = { raw: text };
    }
    return { ok: res.ok, status: res.status, data };
  } catch (e) {
    return { ok: false, error: String(e.message || e), hint: "Start mocks: python3 scripts/start-wc-fastapi-mocks.py" };
  }
}

async function get(base, path) {
  try {
    const res = await fetch(`${base}${path}`);
    const text = await res.text();
    let data;
    try {
      data = JSON.parse(text);
    } catch {
      data = { raw: text };
    }
    return { ok: res.ok, status: res.status, data };
  } catch (e) {
    return { ok: false, error: String(e.message || e) };
  }
}

export function createFastApiMockTools() {
  return [
    {
      name: "xclaw_gmail_list",
      description: "List messages from WildClaw FastAPI mock Gmail (port 9100).",
      parameters: { type: "object", properties: {} },
      async execute() {
        return post(GMAIL, "/gmail/messages", {});
      },
    },
    {
      name: "xclaw_gmail_get",
      description: "Get a mock Gmail message by id.",
      parameters: {
        type: "object",
        properties: { message_id: { type: "string" } },
        required: ["message_id"],
      },
      async execute(args = {}) {
        return post(GMAIL, "/gmail/messages/get", { message_id: args.message_id });
      },
    },
    {
      name: "xclaw_gmail_send",
      description: "Send via mock Gmail (triggers reactive replies on server).",
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
        return post(GMAIL, "/gmail/send", {
          to: args.to,
          subject: args.subject,
          body: args.body,
        });
      },
    },
    {
      name: "xclaw_calendar_list",
      description: "List events from mock Calendar API (port 9101).",
      parameters: { type: "object", properties: {} },
      async execute() {
        return post(CAL, "/calendar/events", {});
      },
    },
    {
      name: "xclaw_calendar_create",
      description: "Create a calendar event on the mock Calendar API.",
      parameters: {
        type: "object",
        properties: {
          title: { type: "string" },
          start: { type: "string" },
          end: { type: "string" },
          location: { type: "string" },
          attendees: { type: "array", items: { type: "string" } },
        },
        required: ["title", "start", "end"],
      },
      async execute(args = {}) {
        return post(CAL, "/calendar/events/create", args);
      },
    },
    {
      name: "xclaw_slack_list",
      description: "List messages from mock Slack API (port 9102) if running.",
      parameters: { type: "object", properties: { channel: { type: "string" } } },
      async execute(args = {}) {
        // try common paths
        const tries = [
          () => post(SLACK, "/slack/messages", args),
          () => get(SLACK, "/slack/messages"),
          () => post(SLACK, "/messages", args),
        ];
        for (const t of tries) {
          const r = await t();
          if (r.ok) return r;
        }
        return {
          ok: false,
          error: "slack mock unreachable or path mismatch",
          hint: "Use xclaw_chat_list for file fixtures if FastAPI slack is down",
        };
      },
    },
  ];
}

export default { createFastApiMockTools };
