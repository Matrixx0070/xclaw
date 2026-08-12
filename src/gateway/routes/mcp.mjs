/**
 * Gateway MCP HTTP routes (split from routes/api.mjs).
 *
 * Paths:
 *   POST /mcp · /mcp/call
 *   GET  /mcp/tools
 */

/** @param {object} args — standard route args + mcpClient, mcpServer (live deps)
 *  @returns {Promise<boolean>} true if handled */
export async function tryHandleMcpRoute({ p, method, req, res, json, readBody, mcpClient, mcpServer }) {
  if (p === "/mcp" && method === "POST") {
    const body = await readBody(req);
    const out = await mcpServer.handleRequest(body);
    json(res, 200, out);
    return true;
  }
  if (p === "/mcp/tools" && method === "GET") {
    const tools = await mcpClient.listTools();
    json(res, 200, { tools });
    return true;
  }
  if (p === "/mcp/call" && method === "POST") {
    const body = await readBody(req);
    const out = await mcpClient.callTool(body.name, body.arguments || body.args || {});
    json(res, 200, out);
    return true;
  }

  return false;
}

export default { tryHandleMcpRoute };
