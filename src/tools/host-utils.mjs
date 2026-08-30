/**
 * Host utility tools — leverage sandbox pre-installed CLIs:
 * magika (file type), markitdown (doc→md), tesseract OCR helper via bash guidance.
 */
import { spawn } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";

function textResult(text, extra = {}) {
  return { content: [{ type: "text", text: String(text ?? "") }], ...extra };
}
function errorResult(msg) {
  return { isError: true, content: [{ type: "text", text: String(msg) }] };
}

function run(cmd, args, { timeoutMs = 60_000, maxBytes = 400_000 } = {}) {
  return new Promise((resolve) => {
    const child = spawn(cmd, args, { shell: false });
    let out = "", err = "";
    const t = setTimeout(() => {
      child.kill("SIGKILL");
      resolve({ code: -1, stdout: out, stderr: err + "\n(timeout)" });
    }, timeoutMs);
    child.stdout.on("data", (d) => {
      if (out.length < maxBytes) out += d.toString();
    });
    child.stderr.on("data", (d) => {
      if (err.length < maxBytes / 4) err += d.toString();
    });
    child.on("close", (c) => {
      clearTimeout(t);
      resolve({ code: c ?? 0, stdout: out, stderr: err });
    });
    child.on("error", (e) => {
      clearTimeout(t);
      resolve({ code: -1, stdout: out, stderr: e.message });
    });
  });
}

export function createFileTypeTool() {
  return {
    name: "file_type",
    description:
      "Detect file type/content using magika (or file). Useful before OCR/conversion.",
    parameters: {
      type: "object",
      properties: {
        path: { type: "string", description: "File path" },
      },
      required: ["path"],
    },
    async execute(args = {}) {
      const p = String(args.path || "").trim();
      if (!p) return errorResult("path required");
      try {
        await fs.access(p);
      } catch {
        return errorResult(`not found: ${p}`);
      }
      const mag = await run("magika", ["-j", p], { timeoutMs: 15_000 });
      if (mag.code === 0 && mag.stdout.trim()) {
        return textResult(mag.stdout.trim(), { metadata: { engine: "magika" } });
      }
      const f = await run("file", ["-b", p]);
      if (f.code !== 0 && !String(f.stdout || "").trim()) {
        return errorResult(
          `file_type failed (magika ${mag.code}, file ${f.code}): ${String(f.stderr || mag.stderr).slice(0, 300)}`
        );
      }
      return textResult(f.stdout.trim() || f.stderr, { metadata: { engine: "file" } });
    },
  };
}

export function createMarkitdownTool() {
  return {
    name: "markitdown",
    description:
      "Convert Office/PDF/HTML files to Markdown using markitdown CLI (pptx, docx, pdf, xlsx, images, etc.).",
    parameters: {
      type: "object",
      properties: {
        path: { type: "string" },
        max_chars: { type: "number" },
      },
      required: ["path"],
    },
    async execute(args = {}) {
      const p = String(args.path || "").trim();
      if (!p) return errorResult("path required");
      const max = Math.min(Number(args.max_chars) || 80_000, 200_000);
      // python -m markitdown path
      let r = await run("python3", ["-m", "markitdown", p], { timeoutMs: 90_000 });
      if (r.code !== 0) {
        r = await run("markitdown", [p], { timeoutMs: 90_000 });
      }
      if (r.code !== 0 && !String(r.stdout || "").trim()) {
        return errorResult(r.stderr || `markitdown failed for ${p}`);
      }
      let text = r.stdout || "";
      if (text.length > max) text = text.slice(0, max) + "\n…[truncated]";
      return textResult(text, {
        metadata: { path: p, chars: text.length, engine: "markitdown" },
      });
    },
  };
}

export function createHostCapabilitiesTool() {
  return {
    name: "host_capabilities",
    description:
      "Report which useful host CLIs are available (ffmpeg, imagemagick, pandoc, tesseract, magika, soffice, etc.).",
    parameters: { type: "object", properties: {} },
    async execute() {
      const bins = [
        "ffmpeg",
        "ffprobe",
        "convert",
        "magick",
        "pandoc",
        "tesseract",
        "magika",
        "soffice",
        "rg",
        "jq",
        "python3",
        "node",
        "markitdown",
        "pdfplumber",
        "pdf2txt.py",
        "pypdfium2",
      ];
      const lines = [];
      for (const b of bins) {
        const r = await run("bash", ["-lc", `command -v ${b} 2>/dev/null || true`], {
          timeoutMs: 3000,
        });
        const loc = (r.stdout || "").trim();
        lines.push(`${loc ? "✓" : "·"} ${b}${loc ? " → " + loc : ""}`);
      }
      // env API presence (names only)
      const apis = ["POLYGON_API_KEY", "COINGECKO_PRO_API_KEY", "XAI_API_KEY", "OPENAI_API_KEY"];
      lines.push("", "API env (present?):");
      for (const k of apis) {
        lines.push(`${process.env[k] ? "✓" : "·"} ${k}`);
      }
      return textResult(lines.join("\n"));
    },
  };
}

export function createHostUtilsTools() {
  return [createFileTypeTool(), createMarkitdownTool(), createHostCapabilitiesTool()];
}

export function hostUtilsAsOpenAI(tools) {
  return tools.map((t) => ({
    type: "function",
    function: {
      name: t.name,
      description: t.description,
      parameters: t.parameters || { type: "object", properties: {} },
    },
  }));
}
