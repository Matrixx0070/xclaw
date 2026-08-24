/**
 * Code Executor Tool — Run code in sandboxed environment
 */
import { spawn } from "child_process";
import { getConfig } from "../../src/swarm/config.mjs";

export class CodeExecuteTool {
  constructor() {
    this.name = "code_execute";
    this.description = "Execute code in a sandboxed environment. Supports JavaScript, Python, and Bash. Returns stdout, stderr, and exit code.";
    this.parameters = {
      code: { type: "string", description: "Code to execute", required: true },
      language: { type: "string", description: "Language: javascript, python, bash", required: true },
      timeout: { type: "number", description: "Timeout in milliseconds", default: 30000 },
      stdin: { type: "string", description: "Input to pipe to the process", default: "" },
    };
  }

  getSchema() {
    return {
      type: "function",
      function: {
        name: this.name,
        description: this.description,
        parameters: {
          type: "object",
          properties: {
            code: { type: "string", description: "Code to execute" },
            language: { type: "string", enum: ["javascript", "python", "bash"], description: "Programming language" },
            timeout: { type: "number", default: 30000 },
            stdin: { type: "string", default: "" },
          },
          required: ["code", "language"],
        },
      },
    };
  }

  async execute({ code, language, timeout = 30000, stdin = "" }) {
    try {
      console.log(`[code-executor] Running ${language} code (${code.length} chars)`);

      const cfg = getConfig().swarm.subAgent.sandbox;
      const commandMap = {
        javascript: ["node", "-e", code],
        python: ["python3", "-c", code],
        bash: ["bash", "-c", code],
      };

      const cmd = commandMap[language];
      if (!cmd) {
        return { success: false, error: `Unsupported language: ${language}` };
      }

      // In production, use Docker sandbox (dockerode)
      // This stub uses child_process with timeout
      return new Promise((resolve) => {
        const proc = spawn(cmd[0], cmd.slice(1), {
          timeout,
          env: { ...process.env, NODE_ENV: "sandbox" },
        });

        let stdout = "";
        let stderr = "";

        if (stdin) {
          proc.stdin.write(stdin);
          proc.stdin.end();
        }

        proc.stdout.on("data", (data) => { stdout += data.toString(); });
        proc.stderr.on("data", (data) => { stderr += data.toString(); });

        const timer = setTimeout(() => {
          proc.kill("SIGKILL");
          resolve({
            success: false,
            error: `Execution timed out after ${timeout}ms`,
            data: { stdout, stderr, exit_code: null, duration_ms: timeout },
          });
        }, timeout + 1000);

        proc.on("close", (code) => {
          clearTimeout(timer);
          resolve({
            success: code === 0,
            data: { stdout, stderr, exit_code: code, duration_ms: timeout },
          });
        });

        proc.on("error", (err) => {
          clearTimeout(timer);
          resolve({ success: false, error: err.message });
        });
      });
    } catch (e) {
      return { success: false, error: e.message };
    }
  }
}
