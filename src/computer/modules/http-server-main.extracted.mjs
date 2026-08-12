/** EXTRACTED xclaw-server.mjs L394324-EOF — routes + main */
}
function configureApp() {
  const app = (0, import_express.default)();
  app.use(import_express.default.json({ limit: "10mb" }));
  app.use(privateNetworkAccessMiddleware);
  app.use((0, import_cors.default)({
    origin: ALLOWED_ORIGINS
  }));
  app.use(touchActivityMiddleware);
  return app;
}
function setupBasicRoutes(app) {
  app.get("/health", (_req, res) => res.status(200).json({ status: "healthy", version: package_default.version }));
  app.get("/pwd", (_req, res) => res.json({ pwd: process.cwd() }));
}
function parseBundledSkills(value) {
  if (value === void 0 || value === null)
    return void 0;
  if (!Array.isArray(value))
    return void 0;
  const valid = new Set(BUNDLED_SKILL_NAMES);
  const invalid = value.filter((v) => typeof v !== "string" || !valid.has(v));
  if (invalid.length > 0) {
    throw new AppError(`Invalid bundledSkills: ${JSON.stringify(invalid)}. Valid values: ${BUNDLED_SKILL_NAMES.join(", ")}`);
  }
  return value;
}
function setupSessionRoutes(app) {
  app.post("/xclaw/sessions/create", async (req, res) => {
    const { workingDir, rootWorkingDir, hasVision, shellBin, unescapeInput, resetCwd, includeGitStatus, enabledTools, bundledSkills, enabledClis, browserHeadless, hasInternetAccess: hasInternetAccess2 } = req.body;
    if (!workingDir) {
      throw new AppError("workingDir required");
    }
    const options = {
      rootWorkingDir,
      hasVision,
      shellBin,
      unescapeInput,
      resetCwd,
      includeGitStatus,
      enabledTools: Array.isArray(enabledTools) ? new Set(enabledTools) : void 0,
      bundledSkills: parseBundledSkills(bundledSkills),
      enabledClis: Array.isArray(enabledClis) ? enabledClis : void 0,
      browserHeadless,
      hasInternetAccess: hasInternetAccess2
    };
    try {
      const sessionId = await createSession(workingDir, options);
      res.json({ sessionId });
    } catch (err2) {
      if (err2 instanceof Error && (err2.message.includes("does not exist") || err2.message.includes("not a directory"))) {
        throw new AppError(err2.message, 400);
      }
      throw err2;
    }
  });
  app.post("/xclaw/sessions/destroy", async (req, res) => {
    const { sessionId } = req.body;
    if (!sessionId) {
      throw new AppError("sessionId required");
    }
    await destroySession(sessionId);
    res.sendStatus(200);
  });
  app.post("/xclaw/sessions/:sessionId/update", async (req, res) => {
    const updates = req.body;
    if ("bundledSkills" in updates && updates.bundledSkills !== void 0) {
      throw new AppError("bundledSkills cannot be changed after session creation");
    }
    await updateSession(req.params.sessionId, updates);
    res.sendStatus(200);
  });
}
function setupToolRoutes(app) {
  app.post("/xclaw/sessions/:sessionId/tools/list", async (req, res) => {
    const session = getSession(req.params.sessionId);
    if (!session) {
      throw new AppError("Session not found", 404);
    }
    ListToolsRequestSchema.parse(req.body);
    const abortController = new AbortController();
    res.on("close", () => {
      if (!res.writableFinished)
        abortController.abort();
    });
    const result = await listToolsHandler(session, abortController);
    res.json(result);
  });
  app.get("/xclaw/sessions/:sessionId/tools/output", async (req, res) => {
    const session = getSession(req.params.sessionId);
    if (!session) {
      throw new AppError("Session not found", 404);
    }
    const partial = await session.shell.getPartialOutput();
    res.json(partial);
  });
  app.post("/xclaw/sessions/:sessionId/tools/call", async (req, res) => {
    const start = Date.now();
    const session = getSession(req.params.sessionId);
    if (!session) {
      throw new AppError("Session not found", 404);
    }
    const request = CallToolRequestSchema.parse(req.body);
    const abortController = new AbortController();
    res.on("close", () => {
      if (!res.writableFinished)
        abortController.abort();
    });
    const rawTraceparent = request.params._meta?.traceparent;
    const traceparent = typeof rawTraceparent === "string" && /^00-[0-9a-f]{32}-[0-9a-f]{16}-[0-9a-f]{2}$/.test(rawTraceparent) ? rawTraceparent : void 0;
    const result = await callToolHandler(request, session, abortController, traceparent);
    result._meta ??= {};
    result._meta.toolDurationMs = Date.now() - start;
    log_default.info({
      tool: request.params.name,
      clientDurationMs: result._meta.toolDurationMs
    }, "Tool call completed (route)");
    res.json(result);
  });
}
function setupSessionInfoRoute(app) {
  app.get("/xclaw/sessions/:sessionId", async (req, res) => {
    const session = getSession(req.params.sessionId);
    if (!session) {
      throw new AppError("Session not found", 404);
    }
    const abortController = new AbortController();
    res.on("close", () => {
      if (!res.writableFinished)
        abortController.abort();
    });
    const [envInfo, contextData, tools, xclawClis] = await Promise.all([
      getEnvInfo(session),
      getContext(session),
      listToolsHandler(session, abortController),
      getXClawClis(session.enabledClis)
    ]);
    const { skills: skillsSection, ...contextWithoutSkills } = contextData;
    if (session.includeGitStatus === false) {
      delete contextWithoutSkills.gitStatus;
    }
    const skills = skillsSection ? `## Skills
${skillsSection.body}` : void 0;
    const context = formatContext(contextWithoutSkills, session);
    res.json({
      sessionId: req.params.sessionId,
      envInfo,
      context,
      // Structured sections (stable id → { title, body }); `context` kept for back-compat.
      contextSections: contextWithoutSkills,
      tools,
      ...xclawClis ? { xclawClis } : {},
      ...skills ? { skills } : {}
    });
  });
}
function setupFilesystemRoutes(app) {
  app.get("/xclaw/filesystem/home", (_req, res) => {
    res.json({ home: getHomeDirectory() });
  });
  app.get("/xclaw/filesystem/common", async (_req, res) => {
    const directories = await getExistingCommonDirectories();
    res.json({ directories });
  });
  app.get("/xclaw/filesystem/exists", async (req, res) => {
    const path12 = req.query.path;
    if (!path12) {
      throw new AppError("path query parameter required");
    }
    const result = await checkPathExists(path12);
    res.json(result);
  });
  app.get("/xclaw/filesystem/list", async (req, res) => {
    const path12 = req.query.path || "~";
    const showHidden = req.query.showHidden === "true";
    try {
      const result = await listDirectory(path12);
      if (!showHidden) {
        result.entries = result.entries.filter((entry) => !entry.isHidden);
      }
      res.json(result);
    } catch (err2) {
      if (err2 instanceof Error) {
        throw new AppError(err2.message, 400);
      }
      throw err2;
    }
  });
  app.get("/xclaw/filesystem/complete", async (req, res) => {
    const prefix = req.query.prefix;
    if (prefix === void 0) {
      throw new AppError("prefix query parameter required");
    }
    const result = await completePath(prefix);
    res.json(result);
  });
}
function setupSkillRoutes(app) {
  app.get("/xclaw/skills/installed", async (req, res) => {
    const workingDir = req.query.workingDir;
    const skills = await listInstalledSkills(workingDir);
    res.json({ skills });
  });
  app.get("/xclaw/skills/available", async (req, res) => {
    const repo = req.query.repo || "xai-org/skills";
    const path12 = req.query.path || "skills/.curated";
    const ref = req.query.ref || "main";
    const workingDir = req.query.workingDir;
    try {
      const skills = await listRemoteSkills(repo, path12, ref, workingDir);
      res.json({ skills });
    } catch (err2) {
      const message = err2 instanceof Error ? err2.message : String(err2);
      res.status(502).json({ error: message });
    }
  });
  app.post("/xclaw/skills/install", async (req, res) => {
    const { repo, path: path12, ref, name, url, scope, workingDir } = req.body;
    if (!url && (!repo || !path12)) {
      throw new AppError('Either "url" or both "repo" and "path" required');
    }
    if (scope === "project" && !workingDir) {
      throw new AppError('"workingDir" is required when scope is "project"');
    }
    try {
      const result = await installSkill({
        repo,
        path: path12,
        ref,
        name,
        url,
        scope,
        workingDir
      });
      invalidateAllSkillCaches();
      res.json(result);
    } catch (err2) {
      const message = err2 instanceof Error ? err2.message : String(err2);
      if (message.includes("already exists")) {
        res.status(409).json({ error: message });
      } else {
        res.status(500).json({ error: message });
      }
    }
  });
  app.post("/xclaw/skills/uninstall", async (req, res) => {
    const { name, scope, workingDir } = req.body;
    if (!name) {
      throw new AppError('"name" is required');
    }
    if (scope === "project" && !workingDir) {
      throw new AppError('"workingDir" is required when scope is "project"');
    }
    try {
      await uninstallSkill(name, scope, workingDir);
      invalidateAllSkillCaches();
      res.json({ success: true, name });
    } catch (err2) {
      const message = err2 instanceof Error ? err2.message : String(err2);
      res.status(400).json({ error: message });
    }
  });
}
function invalidateAllSkillCaches() {
  try {
    const sessions2 = getAllSessions();
    for (const session of sessions2) {
      session.skillManager.invalidateCache();
    }
  } catch {
  }
}
var MAX_STATUS_PATHS = 200;
function setupWorktreeRoutes(app) {
  app.get("/xclaw/worktrees/list", async (req, res) => {
    const repoPath = assertString("repoPath", req.query.repoPath);
    if (!await isGitRepo(repoPath)) {
      res.json({
        worktrees: [],
        defaultBranch: null,
        userSlug: null,
        isGitRepo: false
      });
      return;
    }
    const summary = await getRepoSummary(repoPath);
    res.json({ ...summary, isGitRepo: true });
  });
  app.post("/xclaw/worktrees/create", async (req, res) => {
    const body = req.body ?? {};
    const repoPath = assertString("repoPath", body.repoPath);
    const branch = assertString("branch", body.branch);
    const fromBranch = assertString("fromBranch", body.fromBranch, {
      optional: true
    });
    const donorPath = assertString("donorPath", body.donorPath, {
      optional: true
    });
    const dst = assertString("dst", body.dst, { optional: true });
    const inheritWorkspace = body.inheritWorkspace !== false;
    const skipFetch = body.skipFetch === true;
    try {
      const result = await createWorktree({
        repoPath,
        branch,
        fromBranch,
        inheritWorkspace,
        donorPath,
        dst,
        skipFetch
      });
      res.json(result);
    } catch (err2) {
      if (err2 instanceof WorktreeError) {
        const status = err2.kind === "dst-exists" ? 409 : err2.kind === "not-a-repo" ? 404 : 400;
        res.status(status).json({ error: err2.message, kind: err2.kind });
        return;
      }
      throw err2;
    }
  });
  app.get("/xclaw/worktrees/probe", async (req, res) => {
    const target = assertString("path", req.query.path);
    const result = await probeWorktree(target);
    res.json(result);
  });
  app.post("/xclaw/worktrees/remove", async (req, res) => {
    const body = req.body ?? {};
    const repoPath = assertString("repoPath", body.repoPath);
    const worktreePath = assertString("worktreePath", body.worktreePath);
    const removeBranch = body.removeBranch === true;
    try {
      const result = await removeWorktree2({
        repoPath,
        worktreePath,
        removeBranch
      });
      res.json({ success: true, ...result });
    } catch (err2) {
      if (err2 instanceof WorktreeError) {
        const status = err2.kind === "invalid-target" ? 400 : 404;
        res.status(status).json({ error: err2.message, kind: err2.kind });
        return;
      }
      throw err2;
    }
  });
  app.post("/xclaw/worktrees/status", async (req, res) => {
    const paths = req.body?.paths ?? [];
    if (!Array.isArray(paths)) {
      throw new AppError("paths must be an array of strings");
    }
    if (paths.length > MAX_STATUS_PATHS) {
      throw new AppError(`paths length ${paths.length} exceeds max ${MAX_STATUS_PATHS}`);
    }
    const inputs = paths.filter((p) => typeof p === "string");
    const entries = await Promise.all(inputs.map(async (p) => {
      try {
        const status = await getWorktreeStatus(p);
        return [p, status];
      } catch {
        return [p, null];
      }
    }));
    const out = {};
    for (const [p, s] of entries)
      out[p] = s;
    res.json({ statuses: out });
  });
}
function setupRoutes(app) {
  setupBasicRoutes(app);
  setupFilesystemRoutes(app);
  setupSessionRoutes(app);
  setupToolRoutes(app);
  setupSessionInfoRoute(app);
  setupSkillRoutes(app);
  setupWorktreeRoutes(app);
  cleanupTrashOnStartup();
  void BrowserService.cleanupOrphanedChromesOnStartup().catch((err2) => {
    log_default.warn({ err: err2 instanceof Error ? err2.message : String(err2) }, "cleanupOrphanedChromesOnStartup failed");
  });
  void TransientShell.cleanupOrphanedTempFilesOnStartup().catch((err2) => {
    log_default.warn({ err: err2 instanceof Error ? err2.message : String(err2) }, "cleanupOrphanedTempFilesOnStartup failed");
  });
  startIdleSessionSweeper();
}
async function startListening(app, port) {
  return new Promise((resolve6, reject2) => {
    const server = app.listen(port, "127.0.0.1", () => {
      const local_addr = `127.0.0.1:${port}`;
      const url = `http://${local_addr}`;
      log_default.info(`HTTP server listening on ${local_addr}`);
      resolve6({ url });
    });
    server.on("error", reject2);
  });
}
async function startServer() {
  const port = Number(config_default.port);
  const app = configureApp();
  setupRoutes(app);
  app.use(errorMiddleware);
  try {
    await startListening(app, port);
  } catch (error) {
    log_default.error(`Failed to start server: ${error instanceof Error ? error.message : String(error)}`);
    throw error;
  }
}

// build/stdio.js
import { createInterface } from "readline";
async function startStdioMode() {
  log_default.info("Starting in MCP stdio mode");
  const rl = createInterface({
    input: process.stdin,
    output: process.stdout,
    terminal: false
  });
  let sessionId = null;
  let processing = false;
  const lineQueue = [];
  rl.on("line", (line) => {
    lineQueue.push(line);
    void processNext();
  });
  async function processNext() {
    if (processing || lineQueue.length === 0)
      return;
    processing = true;
    const line = lineQueue.shift();
    let request;
    try {
      request = parseJsonRpcRequest(line);
      const response = await processRequest(request, sessionId);
      if (response) {
        process.stdout.write(JSON.stringify(response) + "\n");
      }
      if (request.method === "session/init" && response?.result) {
        sessionId = response.result.sessionId;
      }
      if (request.method === "session/close" && sessionId) {
        sessionId = null;
      }
    } catch (err2) {
      const errorResponse = createErrorResponse(err2 instanceof Error ? err2.message : "Unknown error", request?.id);
      process.stdout.write(JSON.stringify(errorResponse) + "\n");
    } finally {
      processing = false;
      void processNext();
    }
  }
  rl.on("close", async () => {
    while (lineQueue.length > 0 || processing) {
      await new Promise((resolve6) => setTimeout(resolve6, 50));
    }
    if (sessionId) {
      destroySession(sessionId).catch((err2) => log_default.error("Error destroying session on close", err2));
    }
    log_default.info("Stdio mode closed");
  });
}
function parseJsonRpcRequest(line) {
  let parsed;
  try {
    parsed = JSON.parse(line);
  } catch {
    throw new Error("Invalid JSON");
  }
  if (parsed.jsonrpc !== "2.0" || typeof parsed.method !== "string") {
    throw new Error("Invalid JSON-RPC request");
  }
  return parsed;
}
async function processRequest(request, currentSessionId) {
  const abortController = new AbortController();
  switch (request.method) {
    case "session/init": {
      if (currentSessionId)
        throw new Error("Session already initialized");
      const params = request.params ?? {};
      const workingDir = params.workingDir ?? process.cwd();
      const options = params.options ?? {};
      const newSessionId = await createSession(workingDir, options);
      return {
        jsonrpc: "2.0",
        result: { sessionId: newSessionId },
        id: request.id
      };
    }
    case "tool/discover": {
      if (!currentSessionId)
        throw new Error("Session not initialized");
      const session = getSession(currentSessionId);
      if (!session)
        throw new Error("Session not found");
      const tools = await listToolsHandler(session, abortController);
      return { jsonrpc: "2.0", result: tools, id: request.id };
    }
    case "tool/call": {
      if (!currentSessionId)
        throw new Error("Session not initialized");
      const session = getSession(currentSessionId);
      if (!session)
        throw new Error("Session not found");
      const toolRequest = { params: request.params };
      const result = await callToolHandler(toolRequest, session, abortController);
      return { jsonrpc: "2.0", result, id: request.id };
    }
    case "session/close": {
      if (!currentSessionId)
        throw new Error("No session to close");
      await destroySession(currentSessionId);
      return { jsonrpc: "2.0", result: { success: true }, id: request.id };
    }
    case "session/info": {
      if (!currentSessionId)
        throw new Error("Session not initialized");
      const session = getSession(currentSessionId);
      if (!session)
        throw new Error("Session not found");
      const xclawClis = await getXClawClis(session.enabledClis);
      return {
        jsonrpc: "2.0",
        result: {
          sessionId: session.sessionId,
          workingDir: session.originalWorkingDir,
          hasVision: session.hasVision,
          hasInternetAccess: session.hasInternetAccess,
          shellBin: session.shellBin,
          unescapeInput: session.unescapeInput,
          resetCwd: session.resetCwd,
          includeGitStatus: session.includeGitStatus,
          browserHeadless: session.browserHeadless,
          enabledTools: session.enabledTools ? Array.from(session.enabledTools) : void 0,
          enabledClis: session.enabledClis,
          ...xclawClis ? { xclawClis } : {}
        },
        id: request.id
      };
    }
    default:
      throw new Error(`Unknown method: ${request.method}`);
  }
}
function createErrorResponse(message, id) {
  return {
    jsonrpc: "2.0",
    error: { code: -32601, message },
    id
  };
}

// build/index.js
async function main() {
  log_default.info("Starting XClaw-Computer server");
  try {
    if (process.argv.includes("--stdio")) {
      await startStdioMode();
    } else {
      await startServer();
    }
    log_default.info("Server started successfully");
    process.on("exit", (code) => {
      log_default.info(`Process exiting with code ${code}`);
    });
    process.on("SIGINT", shutdown);
    process.on("SIGTERM", shutdown);
  } catch (err2) {
    log_default.error("Error starting server", err2);
    process.exit(1);
  }
}
async function shutdown() {
  log_default.info("Shutting down server");
  try {
    stopIdleSessionSweeper();
    await destroyAllSessions();
    log_default.info("Shutdown complete");
  } catch (err2) {
    log_default.error("Error during shutdown", err2);
  } finally {
    process.exit(0);
  }
}
main().catch((err2) => {
  log_default.error("Unhandled error in main", err2);
  process.exit(1);
});
export {
  main,
  shutdown
};
/*! Bundled license information:

object-assign/index.js:
  (*
  object-assign
  (c) Sindre Sorhus
  @license MIT
  *)

vary/index.js:
  (*!
   * vary
   * Copyright(c) 2014-2017 Douglas Christopher Wilson
   * MIT Licensed
   *)

depd/index.js:
  (*!
   * depd
   * Copyright(c) 2014-2018 Douglas Christopher Wilson
   * MIT Licensed
   *)

statuses/index.js:
statuses/index.js:
  (*!
   * statuses
   * Copyright(c) 2014 Jonathan Ong
   * Copyright(c) 2016 Douglas Christopher Wilson
   * MIT Licensed
   *)

toidentifier/index.js:
  (*!
   * toidentifier
   * Copyright(c) 2016 Douglas Christopher Wilson
   * MIT Licensed
   *)

http-errors/index.js:
  (*!
   * http-errors
   * Copyright(c) 2014 Jonathan Ong
   * Copyright(c) 2016 Douglas Christopher Wilson
   * MIT Licensed
   *)

ee-first/index.js:
  (*!
   * ee-first
   * Copyright(c) 2014 Jonathan Ong
   * MIT Licensed
   *)

on-finished/index.js:
  (*!
   * on-finished
   * Copyright(c) 2013 Jonathan Ong
   * Copyright(c) 2014 Douglas Christopher Wilson
   * MIT Licensed
   *)

bytes/index.js:
  (*!
   * bytes
   * Copyright(c) 2012-2014 TJ Holowaychuk
   * Copyright(c) 2015 Jed Watson
   * MIT Licensed
   *)

unpipe/index.js:
  (*!
   * unpipe
   * Copyright(c) 2015 Douglas Christopher Wilson
   * MIT Licensed
   *)

raw-body/index.js:
  (*!
   * raw-body
   * Copyright(c) 2013-2014 Jonathan Ong
   * Copyright(c) 2014-2022 Douglas Christopher Wilson
   * MIT Licensed
   *)

body-parser/lib/read.js:
body-parser/lib/types/raw.js:
body-parser/lib/types/text.js:
body-parser/index.js:
  (*!
   * body-parser
   * Copyright(c) 2014-2015 Douglas Christopher Wilson
   * MIT Licensed
   *)

content-type/index.js:
  (*!
   * content-type
   * Copyright(c) 2015 Douglas Christopher Wilson
   * MIT Licensed
   *)

mime-db/index.js:
  (*!
   * mime-db
   * Copyright(c) 2014 Jonathan Ong
   * Copyright(c) 2015-2022 Douglas Christopher Wilson
   * MIT Licensed
   *)

mime-types/index.js:
  (*!
   * mime-types
   * Copyright(c) 2014 Jonathan Ong
   * Copyright(c) 2015 Douglas Christopher Wilson
   * MIT Licensed
   *)

media-typer/index.js:
  (*!
   * media-typer
   * Copyright(c) 2014-2017 Douglas Christopher Wilson
   * MIT Licensed
   *)

type-is/index.js:
  (*!
   * type-is
   * Copyright(c) 2014 Jonathan Ong
   * Copyright(c) 2014-2015 Douglas Christopher Wilson
   * MIT Licensed
   *)

body-parser/lib/types/json.js:
body-parser/lib/types/urlencoded.js:
  (*!
   * body-parser
   * Copyright(c) 2014 Jonathan Ong
   * Copyright(c) 2014-2015 Douglas Christopher Wilson
   * MIT Licensed
   *)

encodeurl/index.js:
  (*!
   * encodeurl
   * Copyright(c) 2016 Douglas Christopher Wilson
   * MIT Licensed
   *)

escape-html/index.js:
  (*!
   * escape-html
   * Copyright(c) 2012-2013 TJ Holowaychuk
   * Copyright(c) 2015 Andreas Lubbe
   * Copyright(c) 2015 Tiancheng "Timothy" Gu
   * MIT Licensed
   *)

parseurl/index.js:
  (*!
   * parseurl
   * Copyright(c) 2014 Jonathan Ong
   * Copyright(c) 2014-2017 Douglas Christopher Wilson
   * MIT Licensed
   *)

finalhandler/index.js:
  (*!
   * finalhandler
   * Copyright(c) 2014-2022 Douglas Christopher Wilson
   * MIT Licensed
   *)

express/lib/view.js:
express/lib/application.js:
express/lib/request.js:
express/lib/express.js:
express/index.js:
  (*!
   * express
   * Copyright(c) 2009-2013 TJ Holowaychuk
   * Copyright(c) 2013 Roman Shtylman
   * Copyright(c) 2014-2015 Douglas Christopher Wilson
   * MIT Licensed
   *)

etag/index.js:
  (*!
   * etag
   * Copyright(c) 2014-2016 Douglas Christopher Wilson
   * MIT Licensed
   *)

forwarded/index.js:
  (*!
   * forwarded
   * Copyright(c) 2014-2017 Douglas Christopher Wilson
   * MIT Licensed
   *)

proxy-addr/index.js:
  (*!
   * proxy-addr
   * Copyright(c) 2014-2016 Douglas Christopher Wilson
   * MIT Licensed
   *)

express/lib/utils.js:
express/lib/response.js:
  (*!
   * express
   * Copyright(c) 2009-2013 TJ Holowaychuk
   * Copyright(c) 2014-2015 Douglas Christopher Wilson
   * MIT Licensed
   *)

router/lib/layer.js:
router/lib/route.js:
router/index.js:
  (*!
   * router
   * Copyright(c) 2013 Roman Shtylman
   * Copyright(c) 2014-2022 Douglas Christopher Wilson
   * MIT Licensed
   *)

negotiator/index.js:
  (*!
   * negotiator
   * Copyright(c) 2012 Federico Romero
   * Copyright(c) 2012-2014 Isaac Z. Schlueter
   * Copyright(c) 2015 Douglas Christopher Wilson
   * MIT Licensed
   *)

accepts/index.js:
  (*!
   * accepts
   * Copyright(c) 2014 Jonathan Ong
   * Copyright(c) 2015 Douglas Christopher Wilson
   * MIT Licensed
   *)

fresh/index.js:
  (*!
   * fresh
   * Copyright(c) 2012 TJ Holowaychuk
   * Copyright(c) 2016-2017 Douglas Christopher Wilson
   * MIT Licensed
   *)

range-parser/index.js:
  (*!
   * range-parser
   * Copyright(c) 2012-2014 TJ Holowaychuk
   * Copyright(c) 2015-2016 Douglas Christopher Wilson
   * MIT Licensed
   *)

safe-buffer/index.js:
  (*! safe-buffer. MIT License. Feross Aboukhadijeh <https://feross.org/opensource> *)

content-disposition/index.js:
  (*!
   * content-disposition
   * Copyright(c) 2014-2017 Douglas Christopher Wilson
   * MIT Licensed
   *)

cookie/index.js:
  (*!
   * cookie
   * Copyright(c) 2012-2014 Roman Shtylman
   * Copyright(c) 2015 Douglas Christopher Wilson
   * MIT Licensed
   *)

send/index.js:
  (*!
   * send
   * Copyright(c) 2012 TJ Holowaychuk
   * Copyright(c) 2014-2022 Douglas Christopher Wilson
   * MIT Licensed
   *)

serve-static/index.js:
  (*!
   * serve-static
   * Copyright(c) 2010 Sencha Inc.
   * Copyright(c) 2011 TJ Holowaychuk
   * Copyright(c) 2014-2016 Douglas Christopher Wilson
   * MIT Licensed
   *)

ieee754/index.js:
  (*! ieee754. BSD-3-Clause License. Feross Aboukhadijeh <https://feross.org/opensource> *)

timm/lib/timm.js:
  (*!
   * Timm
   *
   * Immutability helpers with fast reads and acceptable writes.
   *
   * @copyright Guillermo Grau Panea 2016
   * @license MIT
   *)

image-q/dist/cjs/image-q.cjs:
  (**
   * @preserve
   * Copyright 2015-2018 Igor Bezkrovnyi
   * All rights reserved. (MIT Licensed)
   *
   * cie94.ts - part of Image Quantization Library
   *)
  (**
   * @preserve
   * Copyright 2015-2018 Igor Bezkrovnyi
   * All rights reserved. (MIT Licensed)
   *
   * ciede2000.ts - part of Image Quantization Library
   *)
  (**
   * @preserve
   * Copyright 2015-2018 Igor Bezkrovnyi
   * All rights reserved. (MIT Licensed)
   *
   * cmetric.ts - part of Image Quantization Library
   *)
  (**
   * @preserve
   * Copyright 2015-2018 Igor Bezkrovnyi
   * All rights reserved. (MIT Licensed)
   *
   * common.ts - part of Image Quantization Library
   *)
  (**
   * @preserve
   * Copyright 2015-2018 Igor Bezkrovnyi
   * All rights reserved. (MIT Licensed)
   *
   * constants.ts - part of Image Quantization Library
   *)
  (**
   * @preserve
   * Copyright 2015-2018 Igor Bezkrovnyi
   * All rights reserved. (MIT Licensed)
   *
   * ditherErrorDiffusionArray.ts - part of Image Quantization Library
   *)
  (**
   * @preserve
   * Copyright 2015-2018 Igor Bezkrovnyi
   * All rights reserved. (MIT Licensed)
   *
   * euclidean.ts - part of Image Quantization Library
   *)
  (**
   * @preserve
   * Copyright 2015-2018 Igor Bezkrovnyi
   * All rights reserved. (MIT Licensed)
   *
   * helper.ts - part of Image Quantization Library
   *)
  (**
   * @preserve
   * Copyright 2015-2018 Igor Bezkrovnyi
   * All rights reserved. (MIT Licensed)
   *
   * hueStatistics.ts - part of Image Quantization Library
   *)
  (**
   * @preserve
   * Copyright 2015-2018 Igor Bezkrovnyi
   * All rights reserved. (MIT Licensed)
   *
   * iq.ts - Image Quantization Library
   *)
  (**
   * @preserve
   * Copyright 2015-2018 Igor Bezkrovnyi
   * All rights reserved. (MIT Licensed)
   *
   * lab2rgb.ts - part of Image Quantization Library
   *)
  (**
   * @preserve
   * Copyright 2015-2018 Igor Bezkrovnyi
   * All rights reserved. (MIT Licensed)
   *
   * lab2xyz.ts - part of Image Quantization Library
   *)
  (**
   * @preserve
   * Copyright 2015-2018 Igor Bezkrovnyi
   * All rights reserved. (MIT Licensed)
   *
   * manhattanNeuQuant.ts - part of Image Quantization Library
   *)
  (**
   * @preserve
   * Copyright 2015-2018 Igor Bezkrovnyi
   * All rights reserved. (MIT Licensed)
   *
   * nearestColor.ts - part of Image Quantization Library
   *)
  (**
   * @preserve
   * Copyright 2015-2018 Igor Bezkrovnyi
   * All rights reserved. (MIT Licensed)
   *
   * palette.ts - part of Image Quantization Library
   *)
  (**
   * @preserve
   * Copyright 2015-2018 Igor Bezkrovnyi
   * All rights reserved. (MIT Licensed)
   *
   * pngQuant.ts - part of Image Quantization Library
   *)
  (**
   * @preserve
   * Copyright 2015-2018 Igor Bezkrovnyi
   * All rights reserved. (MIT Licensed)
   *
   * point.ts - part of Image Quantization Library
   *)
  (**
   * @preserve
   * Copyright 2015-2018 Igor Bezkrovnyi
   * All rights reserved. (MIT Licensed)
   *
   * pointContainer.ts - part of Image Quantization Library
   *)
  (**
   * @preserve
   * Copyright 2015-2018 Igor Bezkrovnyi
   * All rights reserved. (MIT Licensed)
   *
   * rgb2hsl.ts - part of Image Quantization Library
   *)
  (**
   * @preserve
   * Copyright 2015-2018 Igor Bezkrovnyi
   * All rights reserved. (MIT Licensed)
   *
   * rgb2lab.ts - part of Image Quantization Library
   *)
  (**
   * @preserve
   * Copyright 2015-2018 Igor Bezkrovnyi
   * All rights reserved. (MIT Licensed)
   *
   * rgb2xyz.ts - part of Image Quantization Library
   *)
  (**
   * @preserve
   * Copyright 2015-2018 Igor Bezkrovnyi
   * All rights reserved. (MIT Licensed)
   *
   * ssim.ts - part of Image Quantization Library
   *)
  (**
   * @preserve
   * Copyright 2015-2018 Igor Bezkrovnyi
   * All rights reserved. (MIT Licensed)
   *
   * wuQuant.ts - part of Image Quantization Library
   *)
  (**
   * @preserve
   * Copyright 2015-2018 Igor Bezkrovnyi
   * All rights reserved. (MIT Licensed)
   *
   * xyz2lab.ts - part of Image Quantization Library
   *)
  (**
   * @preserve
   * Copyright 2015-2018 Igor Bezkrovnyi
   * All rights reserved. (MIT Licensed)
   *
   * xyz2rgb.ts - part of Image Quantization Library
   *)
  (**
   * @preserve
   * MIT License
   *
   * Copyright 2015-2018 Igor Bezkrovnyi
   *
   * Permission is hereby granted, free of charge, to any person obtaining a copy
   * of this software and associated documentation files (the "Software"), to
   * deal in the Software without restriction, including without limitation the
   * rights to use, copy, modify, merge, publish, distribute, sublicense, and/or
   * sell copies of the Software, and to permit persons to whom the Software is
   * furnished to do so, subject to the following conditions:
   *
   * The above copyright notice and this permission notice shall be included in
   * all copies or substantial portions of the Software.
   *
   * THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
   * IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
   * FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL
   * THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
   * LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING
   * FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS
   * IN THE SOFTWARE.
   *
   * riemersma.ts - part of Image Quantization Library
   *)
  (**
   * @preserve TypeScript port:
   * Copyright 2015-2018 Igor Bezkrovnyi
   * All rights reserved. (MIT Licensed)
   *
   * colorHistogram.ts - part of Image Quantization Library
   *)
  (**
   * @preserve TypeScript port:
   * Copyright 2015-2018 Igor Bezkrovnyi
   * All rights reserved. (MIT Licensed)
   *
   * neuquant.ts - part of Image Quantization Library
   *)
  (**
   * @preserve TypeScript port:
   * Copyright 2015-2018 Igor Bezkrovnyi
   * All rights reserved. (MIT Licensed)
   *
   * rgbquant.ts - part of Image Quantization Library
   *)

sax/lib/sax.js:
  (*! http://mths.be/fromcodepoint v0.1.0 by @mathias *)

lodash-es/lodash.js:
  (**
   * @license
   * Lodash (Custom Build) <https://lodash.com/>
   * Build: `lodash modularize exports="es" -o ./`
   * Copyright OpenJS Foundation and other contributors <https://openjsf.org/>
   * Released under MIT license <https://lodash.com/license>
   * Based on Underscore.js 1.8.3 <http://underscorejs.org/LICENSE>
   * Copyright Jeremy Ashkenas, DocumentCloud and Investigative Reporters & Editors
   *)
*/