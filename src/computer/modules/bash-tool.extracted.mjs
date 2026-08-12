/**
 * EXTRACTED from xclaw-server.mjs lines 382468-382575
 * Tool region: bash-tool
 * Status: reference module — depends on bundle scope unless rewired.
 */
var BashTool = {
  name: "xclaw_bash",
  description: () => `Executes a given bash command in a fresh shell at the session working directory.`,
  inputSchema: () => inputSchema,
  isReadOnly: () => false,
  isEnabled: () => true,
  validateInput: async () => {
    return { result: true };
  },
  renderResultForAssistant(data) {
    if (data.pid !== void 0) {
      return [
        {
          type: "text",
          text: `Started in background (PID ${data.pid}). Log file: ${data.logFile}`
        }
      ];
    }
    const { interrupted, stdout, stderr, timedOut, dequeued } = data;
    if (dequeued) {
      return [{ type: "text", text: stderr }];
    }
    let errorMessage = stderr;
    if (interrupted) {
      if (errorMessage.trim())
        errorMessage += EOL;
      errorMessage += "Command was aborted before completion.";
    }
    if (timedOut) {
      if (errorMessage.trim())
        errorMessage += EOL;
      errorMessage += "Command timed out. Retry with a longer `timeout`, or set `background: true` for long-running processes.";
    }
    const hasBoth = stdout.trim() !== "" && errorMessage.trim() !== "";
    return [
      {
        type: "text",
        text: `${stdout}${hasBoth ? "\n" : ""}${errorMessage}`
      }
    ];
  },
  async call(input, context) {
    const { timeout = DEFAULT_TIMEOUT_SECONDS, background } = input;
    let command = context.session.unescapeInput ? fixEscapedString(input.command) : input.command;
    const { abortController } = context;
    const isBackground = background;
    if (context.traceparent) {
      command = `TRACEPARENT='${context.traceparent}' ${command}`;
    }
    const result = await context.session.shell.exec(command, abortController.signal, timeout * 1e3, isBackground);
    let data;
    if (result.pid !== void 0) {
      data = {
        stdout: "",
        stdoutLines: 0,
        stderr: "",
        stderrLines: 0,
        interrupted: result.interrupted,
        pid: result.pid,
        logFile: result.logFile
      };
      const pid = result.pid;
      const logFile = result.logFile;
      const session = context.session;
      const interval = setInterval(async () => {
        try {
          process.kill(pid, 0);
        } catch (e) {
          if (e.code === "ESRCH" && logFile) {
            await appendFile(logFile, `[xclaw-process-exited] background process exited at ${(/* @__PURE__ */ new Date()).toISOString()}
`);
          }
          clearInterval(interval);
          session.backgroundIntervals.delete(interval);
        }
      }, HEALTH_CHECK_INTERVAL_MS);
      session.backgroundIntervals.add(interval);
      if (logFile) {
        session.bgLogFiles.add(logFile);
      }
    } else {
      const stdoutStr = result.stdout;
      let stderrStr = result.stderr;
      const alreadyExplained = result.interrupted || result.timedOut || result.dequeued;
      if (result.code !== 0 && !alreadyExplained) {
        if (stderrStr.trim())
          stderrStr += EOL;
        stderrStr += `Exit code ${result.code}`;
      }
      const { totalLines: stdoutLines, truncatedContent: truncatedStdoutContent } = formatOutput(stdoutStr, input.maxOutputLength);
      const { totalLines: stderrLines, truncatedContent: truncatedStderrContent } = formatOutput(stderrStr, input.maxOutputLength);
      data = {
        stdout: truncatedStdoutContent,
        stdoutLines,
        stderr: truncatedStderrContent,
        stderrLines,
        interrupted: result.interrupted,
        timedOut: result.timedOut,
        dequeued: result.dequeued
      };
    }
    return {
      type: "result",
      resultForAssistant: this.renderResultForAssistant(data),
      data
    };
  }
};
