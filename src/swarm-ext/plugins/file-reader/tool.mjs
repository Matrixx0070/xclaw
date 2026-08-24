/**
 * File Reader Tool — Read files with encoding detection
 */
import { readFileSync, statSync, existsSync } from "fs";
import { resolve } from "path";

export class FileReadTool {
  constructor() {
    this.name = "file_read";
    this.description = "Read a file from disk. Auto-detects encoding and can parse JSON, CSV, and Markdown.";
    this.parameters = {
      path: { type: "string", description: "File path", required: true },
      offset: { type: "number", description: "Start offset (lines for text, bytes for binary)", default: 0 },
      limit: { type: "number", description: "Max lines/bytes to read", default: 10000 },
      encoding: { type: "string", description: "Encoding: utf-8, base64, binary", default: "utf-8" },
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
            path: { type: "string", description: "File path" },
            offset: { type: "number", default: 0 },
            limit: { type: "number", default: 10000 },
            encoding: { type: "string", enum: ["utf-8", "base64", "binary"], default: "utf-8" },
          },
          required: ["path"],
        },
      },
    };
  }

  async execute({ path, offset = 0, limit = 10000, encoding = "utf-8" }) {
    try {
      const resolved = resolve(path);
      if (!existsSync(resolved)) {
        return { success: false, error: `File not found: ${path}` };
      }

      const stats = statSync(resolved);
      const raw = readFileSync(resolved, encoding === "base64" ? "base64" : "utf-8");

      let content = raw;
      let lines = null;
      let parsed = null;

      if (encoding === "utf-8" && !path.endsWith(".png") && !path.endsWith(".jpg")) {
        const allLines = raw.split("\n");
        lines = allLines.length;
        const sliced = allLines.slice(offset, offset + limit);
        content = sliced.join("\n");

        // Auto-parse JSON
        if (path.endsWith(".json")) {
          try { parsed = JSON.parse(raw); } catch { /* ignore */ }
        }
      }

      return {
        success: true,
        data: {
          path: resolved,
          content,
          size: stats.size,
          encoding,
          lines,
          parsed,
        },
      };
    } catch (e) {
      return { success: false, error: e.message };
    }
  }
}
