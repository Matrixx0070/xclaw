/**
 * Adapted from OpenClaw (MIT) — tools-stdio-server / channel-tools patterns
 * MCP JSON-RPC server (HTTP + stdio) exposing XClaw's real surface: sessions,
 * transcripts (as resources), skills, jobs and gateway status.
 */
import { createMcpToolHandlers, handleMcpJsonRpc } from "./handlers.mjs";
import { conversationDescriptor, summarizeStructuredResult, mcpError } from "./shared.mjs";
import { listSessions, getSessionByKey } from "../sessions/router.mjs";
import { xclawVersion } from "./client.mjs";

/**
 * Build built-in MCP tools that mirror OpenClaw channel MCP surface (subset).
 */
export function createXclawBuiltinMcpTools(ctx = {}) {
  return [
    {
      name: "conversations_list",
      description: "List XClaw sessions available through session routes.",
      inputSchema: {
        type: "object",
        properties: {
          limit: { type: "number" },
          channel: { type: "string" },
        },
      },
      async execute(args = {}) {
        let sessions = listSessions();
        if (args.channel) {
          sessions = sessions.filter((s) => s.channel === args.channel);
        }
        if (args.limit) sessions = sessions.slice(0, args.limit);
        const conversations = sessions.map((s) =>
          conversationDescriptor({
            sessionKey: s.sessionKey,
            channel: s.channel,
            peerId: s.peerId,
            title: s.title,
            updatedAt: s.updatedAt,
          })
        );
        return summarizeStructuredResult("conversations", conversations.length, {
          conversations,
        });
      },
    },
    {
      name: "conversation_get",
      description: "Get one XClaw conversation by session key.",
      inputSchema: {
        type: "object",
        properties: { session_key: { type: "string" } },
        required: ["session_key"],
      },
      async execute({ session_key }) {
        const s = getSessionByKey(session_key);
        if (!s) return mcpError(`conversation not found: ${session_key}`);
        const conversation = conversationDescriptor({
          sessionKey: s.sessionKey,
          channel: s.channel,
          peerId: s.peerId,
          title: s.title,
          updatedAt: s.updatedAt,
        });
        return {
          content: [{ type: "text", text: `conversation ${conversation.sessionKey}` }],
          structuredContent: { conversation },
        };
      },
    },
    {
      name: "skills_list",
      description: "List the skills installed on this XClaw instance.",
      inputSchema: { type: "object", properties: {} },
      async execute() {
        const { loadAllSkills } = await import("../skills/loader.mjs");
        const skills = await loadAllSkills({
          configDir: ctx.cfg?.paths?.configDir,
          cwd: process.cwd(),
        });
        return summarizeStructuredResult("skills", skills.length, {
          skills: skills.map((s) => ({ name: s.name, description: s.description })),
        });
      },
    },
    {
      name: "status_get",
      description: "XClaw gateway status: version, active provider/model, queue depth.",
      inputSchema: { type: "object", properties: {} },
      async execute() {
        const cfg = ctx.cfg || {};
        return {
          content: [{ type: "text", text: `xclaw ${xclawVersion()}` }],
          structuredContent: {
            version: xclawVersion(),
            provider: cfg.agent?.provider || null,
            model: cfg.agent?.model || null,
            sessions: listSessions().length,
          },
        };
      },
    },
    {
      name: "job_run",
      description:
        "Run a verified XClaw job (goal → tools → checks). Runs on the operator's gateway and spends their configured provider budget.",
      inputSchema: {
        type: "object",
        properties: {
          goal: { type: "string", description: "what to accomplish" },
          maxTurns: { type: "number" },
        },
        required: ["goal"],
      },
      annotations: { destructiveHint: true, openWorldHint: true },
      async execute({ goal, maxTurns }) {
        const { runJob } = await import("../jobs/job.mjs");
        const job = await runJob({ goal, maxTurns, cfg: ctx.cfg || {} });
        return summarizeStructuredResult("job", 1, {
          job: { id: job.id, status: job.status, pass: job.pass, text: job.text, turns: job.turns },
        });
      },
    },
    ...(ctx.extraTools || []),
  ];
}

/** Transcripts + memory files exposed as MCP resources (xclaw:// URIs). */
function createXclawResourceHandlers(ctx = {}) {
  return {
    async listResources() {
      const out = [];
      try {
        const { listTranscripts } = await import("../sessions/transcript.mjs");
        for (const t of listTranscripts(ctx.cfg || {})) {
          out.push({
            uri: `xclaw://transcripts/${encodeURIComponent(t.sessionId)}`,
            name: `transcript: ${t.sessionId}`,
            mimeType: "application/json",
          });
        }
      } catch {}
      try {
        const { loadMemoryFiles } = await import("../skills/loader.mjs");
        for (const f of await loadMemoryFiles(process.cwd())) {
          out.push({
            uri: `xclaw://memory/${encodeURIComponent(f.name)}`,
            name: `memory: ${f.name}`,
            mimeType: "text/markdown",
          });
        }
      } catch {}
      return { resources: out };
    },
    async readResource({ uri }) {
      const u = String(uri || "");
      const tMatch = u.match(/^xclaw:\/\/transcripts\/(.+)$/);
      if (tMatch) {
        const { loadTranscriptHistory } = await import("../sessions/transcript.mjs");
        const id = decodeURIComponent(tMatch[1]);
        const history = loadTranscriptHistory(ctx.cfg || {}, id, 200);
        return {
          contents: [{ uri: u, mimeType: "application/json", text: JSON.stringify(history, null, 2) }],
        };
      }
      const mMatch = u.match(/^xclaw:\/\/memory\/(.+)$/);
      if (mMatch) {
        const { loadMemoryFiles } = await import("../skills/loader.mjs");
        const name = decodeURIComponent(mMatch[1]);
        const f = (await loadMemoryFiles(process.cwd())).find((x) => x.name === name);
        if (!f) throw new Error(`unknown memory resource: ${name}`);
        return { contents: [{ uri: u, mimeType: "text/markdown", text: f.body }] };
      }
      throw new Error(`unknown resource uri: ${u}`);
    },
  };
}

export function createMcpServer(opts = {}) {
  const tools = opts.tools || createXclawBuiltinMcpTools(opts);
  const handlers = {
    ...createMcpToolHandlers(tools),
    ...createXclawResourceHandlers(opts),
  };
  const serverInfo = { name: "xclaw-mcp", version: xclawVersion() };

  async function handleRequest(body) {
    return handleMcpJsonRpc(handlers, body, { serverInfo });
  }

  return { handlers, handleRequest, tools };
}
