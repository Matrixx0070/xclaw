/**
 * CLEAN file tools — standalone (read / write / edit).
 * Native file tools (single engine).
 */

import fs from "node:fs/promises";
import path from "node:path";

function resolveSafe(cwd, filePath) {
  const root = path.resolve(cwd || process.cwd());
  const target = path.resolve(root, filePath);
  if (!target.startsWith(root + path.sep) && target !== root) {
    const err = new Error(`Path escapes workspace: ${filePath}`);
    err.code = "E_SANDBOX";
    throw err;
  }
  return target;
}

export async function fileRead(input = {}, ctx = {}) {
  const cwd = ctx.cwd || process.cwd();
  const target = resolveSafe(cwd, input.path || input.file_path);
  const content = await fs.readFile(target, "utf8");
  const offset = Math.max(1, Number(input.offset) || 1);
  const limit = Number(input.limit) || 2000;
  const lines = content.split("\n");
  const slice = lines.slice(offset - 1, offset - 1 + limit);
  return {
    ok: true,
    path: target,
    content: slice.join("\n"),
    totalLines: lines.length,
    offset,
    limit,
  };
}

export async function fileWrite(input = {}, ctx = {}) {
  const cwd = ctx.cwd || process.cwd();
  const target = resolveSafe(cwd, input.path || input.file_path);
  await fs.mkdir(path.dirname(target), { recursive: true });
  const content = input.content ?? "";
  await fs.writeFile(target, content, "utf8");
  return {
    ok: true,
    path: target,
    bytes: Buffer.byteLength(String(content), "utf8"),
  };
}

export async function fileEdit(input = {}, ctx = {}) {
  const cwd = ctx.cwd || process.cwd();
  const target = resolveSafe(cwd, input.path || input.file_path);
  let text = await fs.readFile(target, "utf8");
  const oldStr = input.old_string ?? input.oldString ?? "";
  const newStr = input.new_string ?? input.newString ?? "";
  if (!oldStr) {
    return { ok: false, error: "old_string required" };
  }
  if (input.replace_all || input.replaceAll) {
    if (!text.includes(oldStr)) {
      return { ok: false, error: "old_string not found" };
    }
    text = text.split(oldStr).join(newStr);
  } else {
    const idx = text.indexOf(oldStr);
    if (idx < 0) return { ok: false, error: "old_string not found" };
    const second = text.indexOf(oldStr, idx + 1);
    if (second >= 0 && !input.replace_all) {
      return { ok: false, error: "old_string appears multiple times; use replace_all" };
    }
    text = text.slice(0, idx) + newStr + text.slice(idx + oldStr.length);
  }
  await fs.writeFile(target, text, "utf8");
  return { ok: true, path: target };
}

export const FileReadTool = {
  name: "xclaw_file_read",
  description: "Read a UTF-8 text file (optional offset/limit lines).",
  inputSchema: {
    type: "object",
    properties: {
      path: { type: "string" },
      offset: { type: "number" },
      limit: { type: "number" },
    },
    required: ["path"],
  },
  isReadOnly: () => true,
  async call(input, context = {}) {
    return { data: await fileRead(input, context) };
  },
};

export const FileWriteTool = {
  name: "xclaw_file_write",
  description: "Write text to a file (create/overwrite) within the workspace.",
  inputSchema: {
    type: "object",
    properties: {
      path: { type: "string" },
      content: { type: "string" },
    },
    required: ["path", "content"],
  },
  isReadOnly: () => false,
  async call(input, context = {}) {
    return { data: await fileWrite(input, context) };
  },
};

export const FileEditTool = {
  name: "xclaw_file_edit",
  description: "Replace old_string with new_string in a file.",
  inputSchema: {
    type: "object",
    properties: {
      path: { type: "string" },
      old_string: { type: "string" },
      new_string: { type: "string" },
      replace_all: { type: "boolean" },
    },
    required: ["path", "old_string", "new_string"],
  },
  isReadOnly: () => false,
  async call(input, context = {}) {
    return { data: await fileEdit(input, context) };
  },
};

export default {
  FileReadTool,
  FileWriteTool,
  FileEditTool,
  fileRead,
  fileWrite,
  fileEdit,
};
