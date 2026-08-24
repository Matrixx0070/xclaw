/**
 * Computer: Files — File system operations
 * Read, write, list, search files
 */
import { readFileSync, writeFileSync, readdirSync, statSync, existsSync } from "fs";
import { join } from "path";

export class FilesTool {
  constructor() {
    this.name = "files";
    this.description = "File system operations (read, write, list, search)";
    this.parameters = {
      operation: { type: "string", enum: ["read", "write", "list", "search", "stat"], required: true },
      path: { type: "string", description: "File or directory path", required: true },
      content: { type: "string", description: "Content to write (for write operation)" },
      pattern: { type: "string", description: "Search pattern (for search operation)" },
      maxLines: { type: "integer", description: "Max lines to read", default: 1000 },
    };
  }

  async execute({ operation, path, content, pattern, maxLines = 1000 }) {
    try {
      switch (operation) {
        case "read": {
          const data = readFileSync(path, "utf-8");
          const lines = data.split("\n").slice(0, maxLines);
          return {
            success: true,
            data: { content: lines.join("\n"), totalLines: data.split("\n").length, path },
          };
        }
        case "write": {
          writeFileSync(path, content, "utf-8");
          return { success: true, data: { path, bytesWritten: content.length } };
        }
        case "list": {
          const entries = readdirSync(path, { withFileTypes: true });
          return {
            success: true,
            data: {
              path,
              entries: entries.map(e => ({ name: e.name, isDirectory: e.isDirectory(), isFile: e.isFile() })),
            },
          };
        }
        case "search": {
          // Simple recursive search
          const results = this._searchDirectory(path, pattern);
          return { success: true, data: { path, pattern, matches: results.slice(0, 100) } };
        }
        case "stat": {
          const stats = statSync(path);
          return {
            success: true,
            data: {
              path,
              size: stats.size,
              isFile: stats.isFile(),
              isDirectory: stats.isDirectory(),
              modifiedAt: stats.mtime,
              createdAt: stats.birthtime,
            },
          };
        }
        default:
          return { success: false, error: `Unknown operation: ${operation}` };
      }
    } catch (e) {
      return { success: false, error: e.message };
    }
  }

  _searchDirectory(dir, pattern, results = []) {
    if (results.length >= 100) return results;
    try {
      const entries = readdirSync(dir, { withFileTypes: true });
      for (const entry of entries) {
        const fullPath = join(dir, entry.name);
        if (entry.name.includes(pattern)) {
          results.push(fullPath);
        }
        if (entry.isDirectory()) {
          this._searchDirectory(fullPath, pattern, results);
        }
      }
    } catch {
      // Permission denied, skip
    }
    return results;
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
          required: ["operation", "path"],
        },
      },
    };
  }
}
