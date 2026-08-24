/**
 * python_session tool tests — CI-safe: a local node:http fake stands in for
 * the Jupyter kernel pool server (XCLAW_KERNEL_POOL_PORT env override), and
 * the venv-presence gate is exercised via XCLAW_KERNEL_PY. Risk-classifier
 * coverage proves arbitrary Python is exec-family (never auto-runs) and that
 * credential-touching code escalates to critical.
 */
import test from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { mkdtempSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const ws = () => mkdtempSync(join(tmpdir(), "pytool-"));

/** Boot a fake pool server; returns { port, calls, close, respond }. */
function fakePool(handler) {
  const calls = [];
  const server = http.createServer((req, res) => {
    let body = "";
    req.on("data", (d) => (body += d));
    req.on("end", () => {
      const parsed = body ? JSON.parse(body) : null;
      calls.push({ method: req.method, url: req.url, body: parsed });
      const out = handler(req.method, req.url, parsed);
      res.writeHead(out.status || 200, { "Content-Type": "application/json" });
      res.end(JSON.stringify(out.body ?? {}));
    });
  });
  return new Promise((resolve) => {
    server.listen(0, "127.0.0.1", () => {
      resolve({
        port: server.address().port,
        calls,
        close: () => new Promise((r) => server.close(r)),
      });
    });
  });
}

/** Import a fresh copy of the module with env pinned (module caches POOL_PORT). */
async function freshTool(env) {
  const saved = {};
  for (const [k, v] of Object.entries(env)) {
    saved[k] = process.env[k];
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
  const mod = await import(`../src/tools/python-tools.mjs?t=${Date.now()}-${Math.random()}`);
  for (const [k, v] of Object.entries(saved)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
  return mod;
}

const text = (r) => (r.content || []).filter((c) => c.type === "text").map((c) => c.text).join("\n");

test("python_session: executes via the pool and returns output", async () => {
  const pool = await fakePool((method, url) => {
    if (url === "/health") return { body: { status: "ok" } };
    if (url === "/execute")
      return { body: { success: true, output: "sum: 60", error: null, images: [], session: "default" } };
    return { status: 404, body: { detail: "nope" } };
  });
  const { createPythonSessionTool } = await freshTool({
    XCLAW_KERNEL_POOL_PORT: String(pool.port),
    XCLAW_KERNEL_PY: "/bin/true", // exists → venv gate passes
  });
  const tool = createPythonSessionTool({ workingDir: ws() });
  const res = await tool.execute({ code: "df.y.sum()" });
  assert.equal(res.isError, undefined);
  assert.match(text(res), /sum: 60/);
  assert.equal(res.metadata.stateful, true);
  const exec = pool.calls.find((c) => c.url === "/execute");
  assert.equal(exec.body.code, "df.y.sum()");
  assert.equal(exec.body.session, "default");
  await pool.close();
});

test("python_session: session id + timeout clamp forwarded; reset hits reset route first", async () => {
  const pool = await fakePool((method, url) => {
    if (url === "/health") return { body: { status: "ok" } };
    if (url.endsWith("/reset")) return { body: { success: true } };
    if (url === "/execute")
      return { body: { success: true, output: "ok", error: null, images: [], session: "s1" } };
    return { status: 404, body: {} };
  });
  const { createPythonSessionTool } = await freshTool({
    XCLAW_KERNEL_POOL_PORT: String(pool.port),
    XCLAW_KERNEL_PY: "/bin/true",
  });
  const tool = createPythonSessionTool({ workingDir: ws() });
  const res = await tool.execute({ code: "x=1", session: "s1", timeout: 9999, reset: true });
  assert.equal(res.isError, undefined);
  const urls = pool.calls.map((c) => c.url);
  const resetIdx = urls.indexOf("/sessions/s1/reset");
  const execIdx = urls.indexOf("/execute");
  assert.ok(resetIdx >= 0 && execIdx > resetIdx, `reset before execute: ${urls.join(",")}`);
  const exec = pool.calls[execIdx];
  assert.equal(exec.body.session, "s1");
  assert.equal(exec.body.timeout, 600); // clamped
  await pool.close();
});

test("python_session: kernel error surfaces as isError with ANSI stripped", async () => {
  const pool = await fakePool((method, url) => {
    if (url === "/health") return { body: { status: "ok" } };
    if (url === "/execute")
      return {
        body: {
          success: false,
          output: "",
          error: "\x1b[0;31mNameError\x1b[0m: name 'df' is not defined",
          images: [],
          session: "default",
        },
      };
    return { status: 404, body: {} };
  });
  const { createPythonSessionTool } = await freshTool({
    XCLAW_KERNEL_POOL_PORT: String(pool.port),
    XCLAW_KERNEL_PY: "/bin/true",
  });
  const tool = createPythonSessionTool({ workingDir: ws() });
  const res = await tool.execute({ code: "df" });
  assert.equal(res.isError, true);
  assert.match(text(res), /NameError: name 'df' is not defined/);
  assert.ok(!text(res).includes("\x1b"), "ANSI must be stripped");
  await pool.close();
});

test("python_session: images land in the workspace as PNG files, not inline base64", async () => {
  // 1x1 transparent PNG
  const png =
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==";
  const pool = await fakePool((method, url) => {
    if (url === "/health") return { body: { status: "ok" } };
    if (url === "/execute")
      return { body: { success: true, output: "", error: null, images: [png], session: "plot" } };
    return { status: 404, body: {} };
  });
  const { createPythonSessionTool } = await freshTool({
    XCLAW_KERNEL_POOL_PORT: String(pool.port),
    XCLAW_KERNEL_PY: "/bin/true",
  });
  const dir = ws();
  const tool = createPythonSessionTool({ workingDir: dir });
  const res = await tool.execute({ code: "plt.plot([1,2])", session: "plot" });
  assert.equal(res.isError, undefined);
  const files = readdirSync(dir).filter((f) => f.startsWith("py_plot_") && f.endsWith(".png"));
  assert.equal(files.length, 1);
  assert.match(text(res), /1 image\(s\) saved/);
  assert.ok(!text(res).includes(png), "base64 must not be inlined into the result text");
  await pool.close();
});

test("python_session: empty code rejected; missing venv yields typed install error", async () => {
  const { createPythonSessionTool } = await freshTool({
    XCLAW_KERNEL_POOL_PORT: "1", // nothing listens on port 1 → not healthy
    XCLAW_KERNEL_PY: "/nonexistent/venv/bin/python",
  });
  const tool = createPythonSessionTool({ workingDir: ws() });
  const empty = await tool.execute({ code: "   " });
  assert.equal(empty.isError, true);
  const res = await tool.execute({ code: "print(1)" });
  assert.equal(res.isError, true);
  assert.match(text(res), /kernel pool unavailable/);
  assert.match(text(res), /pip install/);
});

test("createPythonTools: venv gate controls advertisement", async () => {
  const gated = await freshTool({ XCLAW_KERNEL_PY: "/nonexistent/venv/bin/python" });
  assert.equal(gated.createPythonTools({ workingDir: ws(), cfg: {} }).length, 0);
  assert.equal(
    gated.createPythonTools({ workingDir: ws(), cfg: { tools: { python: { enabled: true } } } }).length,
    1
  );
  const present = await freshTool({ XCLAW_KERNEL_PY: "/bin/true" });
  const tools = present.createPythonTools({ workingDir: ws(), cfg: {} });
  assert.equal(tools.length, 1);
  assert.equal(tools[0].name, "python_session");
});

test("risk: python_session is exec-family — tiers risky, never low/safe", async () => {
  const { assessRisk, tierRank } = await import("../src/security/risk.mjs");
  const risk = assessRisk({
    tool: "python_session",
    args: { code: "import pandas as pd\npd.DataFrame({'x':[1]})" },
    workingDir: "/root/xclaw",
  });
  assert.equal(risk.factors.impact, "exec");
  assert.ok(tierRank(risk.tier) >= tierRank("risky"), `expected >= risky, got ${risk.tier}`);
});

test("risk: credential-touching python code escalates to critical", async () => {
  const { assessRisk } = await import("../src/security/risk.mjs");
  const risk = assessRisk({
    tool: "python_session",
    args: { code: "open('/root/.ssh/id_rsa').read()" },
    workingDir: "/root/xclaw",
  });
  assert.equal(risk.tier, "critical");
  assert.ok(risk.reasons.some((r) => /credential/.test(r)));
});

test("risk: swarm bridge denies python_session at default tier even if allow-listed", async () => {
  const { createXclawToolBridge } = await import("../src/swarm/tool-bridge.mjs");
  const schemas = [
    {
      type: "function",
      function: { name: "python_session", description: "py", parameters: { type: "object", properties: {} } },
    },
  ];
  const bridge = await createXclawToolBridge(
    { swarm: { decompose: { tools: { allow: ["python_session"], alwaysAllow: [] } } } },
    {
      workingDir: ws(),
      computer: null,
      localTools: [{ name: "python_session", description: "py", parameters: schemas[0].function.parameters }],
      router: { dispatch: async () => ({ ok: true, result: { content: [{ type: "text", text: "ran" }] } }) },
    }
  );
  assert.ok(bridge.has("python_session"));
  const res = await bridge.execute("python_session", { code: "print(1)" });
  assert.equal(res.success, false);
  assert.equal(res.blocked, true);
  assert.match(res.error, /risk policy/);
});

test("role tool packs: act and browse expose python_session (risk gate still pends it)", async () => {
  const { ROLE_TOOL_PACKS } = await import("../src/providers/role-router.mjs");
  assert.ok(ROLE_TOOL_PACKS.act.includes("python_session"));
  assert.ok(ROLE_TOOL_PACKS.browse.includes("python_session"));
});
