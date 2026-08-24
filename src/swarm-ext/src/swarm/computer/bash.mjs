/**
 * Computer: Bash — Execute shell commands in sandboxed environment
 * XClaw-style computer tool with safety controls
 */
import { spawn } from "child_process";
import { getConfig } from "../config.mjs";

export class BashTool {
  constructor() {
    this.name = "bash";
    this.description = "Execute bash/shell commands";
    this.parameters = {
      command: { type: "string", description: "Command to execute", required: true },
      timeout: { type: "integer", description: "Timeout in seconds", default: 60 },
      cwd: { type: "string", description: "Working directory", default: "/tmp" },
    };
  }

  async execute({ command, timeout = 60, cwd = "/tmp" }) {
    const cfg = getConfig().swarm.subAgent.sandbox;

    return new Promise((resolve) => {
      const proc = spawn("bash", ["-c", command], {
        cwd,
        timeout: timeout * 1000,
        env: {
          PATH: "/usr/local/bin:/usr/bin:/bin",
          HOME: "/tmp",
        },
      });

      let stdout = "";
      let stderr = "";

      proc.stdout.on("data", (data) => { stdout += data.toString(); });
      proc.stderr.on("data", (data) => { stderr += data.toString(); });

      proc.on("close", (code) => {
        resolve({
          success: code === 0,
          data: { stdout, stderr, exitCode: code },
          metadata: { command, cwd, duration: timeout },
        });
      });

      proc.on("error", (err) => {
        resolve({ success: false, error: err.message });
      });
    });
  }

  getSchema() {
    return {
      type: "function",
      function: {
        name: this.name,
        description: this.description,
        parameters: {
          type: "object",
          properties: this.parameters,
          required: ["command"],
        },
      },
    };
  }
}
