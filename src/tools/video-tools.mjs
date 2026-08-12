/**
 * view_x_video — sample frames + optional subtitles/OCR (ffmpeg).
 */
import { spawn } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import crypto from "node:crypto";

function textResult(text, extra = {}) {
  return { content: [{ type: "text", text: String(text ?? "") }], ...extra };
}
function errorResult(msg) {
  return { isError: true, content: [{ type: "text", text: String(msg) }] };
}

function run(cmd, args, opts = {}) {
  const timeoutMs = opts.timeoutMs ?? 120_000;
  return new Promise((resolve) => {
    const child = spawn(cmd, args, { shell: false });
    let out = "", err = "";
    const t = setTimeout(() => {
      child.kill("SIGKILL");
      resolve({ code: -1, stdout: out, stderr: err + "\n(timeout)" });
    }, timeoutMs);
    child.stdout.on("data", (d) => {
      if (out.length < 400_000) out += d.toString();
    });
    child.stderr.on("data", (d) => {
      if (err.length < 100_000) err += d.toString();
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

export function createViewXVideoTool({ workingDir } = {}) {
  return {
    name: "view_x_video",
    description:
      "Inspect a video file: probe metadata, extract sample frames (ffmpeg), optional subtitle dump and OCR on frames.",
    parameters: {
      type: "object",
      properties: {
        path: { type: "string", description: "Local video path" },
        frames: { type: "number", description: "Number of frames to extract (default 4, max 12)" },
        ocr: { type: "boolean", description: "OCR extracted frames (default false)" },
        subtitles: { type: "boolean", description: "Try extract embedded subs (default true)" },
      },
      required: ["path"],
    },
    async execute(args = {}) {
      const p = path.resolve(workingDir || process.cwd(), String(args.path || ""));
      try {
        await fs.access(p);
      } catch {
        return errorResult(`not found: ${p}`);
      }
      const nFrames = Math.min(Math.max(Number(args.frames) || 4, 1), 12);
      const outRoot = path.join(workingDir || process.cwd(), "artifacts", "video_frames");
      const job = crypto.randomBytes(4).toString("hex");
      const outDir = path.join(outRoot, job);
      await fs.mkdir(outDir, { recursive: true });

      const probe = await run(
        "ffprobe",
        [
          "-v",
          "error",
          "-show_entries",
          "format=duration,size,bit_rate:stream=codec_type,codec_name,width,height,r_frame_rate",
          "-of",
          "json",
          p,
        ],
        { timeoutMs: 30_000 }
      );
      let meta = {};
      try {
        meta = JSON.parse(probe.stdout || "{}");
      } catch {
        meta = { raw: probe.stdout || probe.stderr };
      }
      const duration = Number(meta.format?.duration) || 0;
      const lines = [
        `video: ${p}`,
        `duration: ${duration || "?"}s`,
        `format: ${JSON.stringify(meta.format || {}).slice(0, 300)}`,
      ];
      for (const s of meta.streams || []) {
        lines.push(
          `stream: ${s.codec_type} ${s.codec_name} ${s.width || ""}x${s.height || ""} @ ${s.r_frame_rate || ""}`
        );
      }

      // Extract frames evenly spaced
      const framePaths = [];
      for (let i = 0; i < nFrames; i++) {
        const tsec =
          duration > 0 ? Math.max(0.1, (duration * (i + 0.5)) / nFrames) : i * 2;
        const dest = path.join(outDir, `frame_${String(i).padStart(2, "0")}.jpg`);
        const r = await run(
          "ffmpeg",
          ["-y", "-ss", String(tsec), "-i", p, "-frames:v", "1", "-q:v", "3", dest],
          { timeoutMs: 60_000 }
        );
        try {
          await fs.access(dest);
          framePaths.push({ t: tsec, path: dest });
        } catch {
          lines.push(`frame ${i} failed: ${(r.stderr || "").slice(-200)}`);
        }
      }
      lines.push(`frames (${framePaths.length}):`);
      for (const f of framePaths) lines.push(`  t=${f.t.toFixed?.(2) ?? f.t}s → ${f.path}`);

      // Subtitles
      if (args.subtitles !== false) {
        const srt = path.join(outDir, "subs.srt");
        const r = await run(
          "ffmpeg",
          ["-y", "-i", p, "-map", "0:s:0", srt],
          { timeoutMs: 60_000 }
        );
        try {
          const text = await fs.readFile(srt, "utf8");
          lines.push("subtitles:", text.slice(0, 4000));
        } catch {
          lines.push("subtitles: none or extract failed");
        }
      }

      // OCR frames
      if (args.ocr) {
        for (const f of framePaths.slice(0, 6)) {
          const base = path.join(outDir, `ocr_${path.basename(f.path, path.extname(f.path))}`);
          const r = await run("tesseract", [f.path, base, "-l", "eng"], { timeoutMs: 60_000 });
          try {
            const text = (await fs.readFile(`${base}.txt`, "utf8")).trim();
            if (text) lines.push(`ocr@${f.t}:`, text.slice(0, 1500));
          } catch {
            /* */
          }
        }
      }

      return textResult(lines.join("\n"), {
        metadata: { path: p, frames: framePaths, outDir, duration },
      });
    },
  };
}

export function createVideoTools(ctx = {}) {
  return [createViewXVideoTool({ workingDir: ctx.workingDir })];
}
