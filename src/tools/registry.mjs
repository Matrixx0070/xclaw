/**
 * Aggregate all local (non-computer-server) tools for the agent loop.
 */
import { createExtraTools, extraToolsAsOpenAI } from "./extra-tools.mjs";
import { createHostUtilsTools, hostUtilsAsOpenAI } from "./host-utils.mjs";
import { createMediaTools } from "./media-tools.mjs";
import { createFinanceTools } from "./finance-tools.mjs";
import { createImageTools } from "./image-tools.mjs";
import { createXTools } from "./x-tools.mjs";
import { createConnectedTools } from "./connected-tools.mjs";
import { createBrowserTools } from "./browser-tools.mjs";
import { createVideoTools } from "./video-tools.mjs";
import { createSkillTools } from "./skill-tools.mjs";
import { createSpawnTools } from "./spawn-tools.mjs";
import { createPythonTools } from "./python-tools.mjs";
import { createMockMailTools } from "./mock-mail.mjs";
import { createMockChatTools } from "./mock-chat.mjs";
import { createFastApiMockTools } from "./mock-fastapi-client.mjs";

export function createAllLocalTools(ctx = {}) {
  const workingDir = ctx.workingDir || process.cwd();
  const cfg = ctx.cfg || {};
  const tools = [
    ...createExtraTools({ workingDir, cfg }),
    ...createHostUtilsTools(),
    ...createMediaTools({ workingDir, cfg }),
    ...createFinanceTools(),
    ...createImageTools({ workingDir, cfg }),
    ...createXTools(),
    ...createConnectedTools({ workingDir, cfg }),
    ...createBrowserTools({ workingDir, cfg, computer: ctx.computer, sessionId: ctx.sessionId }),
    ...createVideoTools({ workingDir }),
    ...createSkillTools({ workingDir, cfg }),
    ...createSpawnTools({ workingDir, cfg, runState: ctx.spawnState }),
    // Stateful Jupyter-kernel Python (advertised only when the kernel venv
    // exists on this host); exec-family for risk purposes — never auto-runs.
    ...createPythonTools({ workingDir, cfg }),
    // Eval-only mock tools (mail/chat/fastapi) are NOT part of the
    // production tool surface: advertising xclaw_gmail_send etc. to the
    // model in real runs invites it to "send email" into a mock
    // (2026-08-23 audit C#5). Eval harnesses opt in explicitly.
    ...(cfg.tools?.mockTools === true || process.env.XCLAW_MOCK_TOOLS === "1"
      ? [
          ...createMockMailTools(workingDir),
          ...createMockChatTools(workingDir),
          ...createFastApiMockTools(),
        ]
      : []),
  ];
  return tools;
}

export function localToolsAsOpenAI(tools) {
  return tools.map((t) => ({
    type: "function",
    function: {
      name: t.name,
      description: t.description,
      parameters: t.parameters || { type: "object", properties: {} },
    },
  }));
}

export function localToolNames(tools) {
  return tools.map((t) => t.name);
}

export async function executeLocalTool(tools, name, args) {
  const tool = tools.find((t) => t.name === name);
  if (!tool) return null;
  return tool.execute(args || {});
}
