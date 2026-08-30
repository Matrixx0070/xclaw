/**
 * Media tools — OCR, office convert, image helpers (robust, fail-soft).
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
  const maxBytes = opts.maxBytes ?? 500_000;
  const cwd = opts.cwd;
  return new Promise((resolve) => {
    const child = spawn(cmd, args, { shell: false, cwd });
    let out = "", err = "";
    const t = setTimeout(() => {
      child.kill("SIGKILL");
      resolve({ code: -1, stdout: out, stderr: err + "\n(timeout)", timedOut: true });
    }, timeoutMs);
    child.stdout.on("data", (d) => {
      if (out.length < maxBytes) out += d.toString();
    });
    child.stderr.on("data", (d) => {
      if (err.length < maxBytes / 4) err += d.toString();
    });
    child.on("close", (c) => {
      clearTimeout(t);
      resolve({ code: c ?? 0, stdout: out, stderr: err, timedOut: false });
    });
    child.on("error", (e) => {
      clearTimeout(t);
      resolve({ code: -1, stdout: out, stderr: e.message, timedOut: false });
    });
  });
}

async function ensureDir(d) {
  await fs.mkdir(d, { recursive: true });
}

export function createOcrTool({ workingDir }) {
  return {
    name: "ocr",
    description:
      "OCR text from an image or PDF page using tesseract. Supports png/jpg/tiff/pdf (pdf via first-page convert).",
    parameters: {
      type: "object",
      properties: {
        path: { type: "string" },
        lang: { type: "string", description: "tesseract lang, default eng" },
        max_chars: { type: "number" },
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
      const lang = args.lang || "eng";
      const max = Math.min(Number(args.max_chars) || 50_000, 200_000);
      let input = p;
      const ext = path.extname(p).toLowerCase();
      const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "xclaw-ocr-"));
      try {
        if (ext === ".pdf") {
          // try pdftoppm or convert first page
          const outBase = path.join(tmpDir, "page");
          let r = await run("pdftoppm", ["-png", "-f", "1", "-l", "1", p, outBase], {
            timeoutMs: 60_000,
          });
          if (r.code !== 0) {
            r = await run(
              "convert",
              ["-density", "150", `${p}[0]`, path.join(tmpDir, "page.png")],
              { timeoutMs: 60_000 }
            );
            input = path.join(tmpDir, "page.png");
          } else {
            input = `${outBase}-1.png`;
            try {
              await fs.access(input);
            } catch {
              input = path.join(tmpDir, "page.png");
            }
          }
        }
        const outBase = path.join(tmpDir, "out");
        const r = await run("tesseract", [input, outBase, "-l", lang], { timeoutMs: 90_000 });
        if (r.code !== 0) {
          return errorResult(r.stderr || "tesseract failed");
        }
        let text;
        try {
          text = await fs.readFile(`${outBase}.txt`, "utf8");
        } catch {
          return errorResult("tesseract reported success but output file missing");
        }
        if (text.length > max) text = text.slice(0, max) + "\n…[truncated]";
        return textResult(text.trim() || "(no text recognized)", {
          metadata: { path: p, lang, engine: "tesseract" },
        });
      } finally {
        await fs.rm(tmpDir, { recursive: true, force: true }).catch(() => {});
      }
    },
  };
}

export function looksLikeConvertedDocument(buf, convertTo) {
  if (!buf || buf.length < 32) return false;
  const fmt = String(convertTo || "").split(":")[0].toLowerCase();
  const s = Buffer.from(buf.subarray(0, 16)).toString("latin1");
  if (fmt === "pdf") return s.startsWith("%PDF");
  if (fmt === "html" || fmt === "xhtml") {
    return /<(html|!doctype)/i.test(Buffer.from(buf.subarray(0, 200)).toString("utf8"));
  }
  if (["docx", "xlsx", "pptx", "odt", "ods", "odp"].includes(fmt)) return s.startsWith("PK");
  return buf.length >= 32;
}

export function createOfficeConvertTool({ workingDir, cfg } = {}) {
  return {
    name: "office_convert",
    description:
      "Convert Office/PDF documents with LibreOffice soffice --headless (docx/pptx/xlsx/odt → pdf/docx/etc). Uses isolated UserInstallation profile; see docs/LIBREOFFICE_HEADLESS.md (CLI + UNO).",
    parameters: {
      type: "object",
      properties: {
        path: { type: "string" },
        format: {
          type: "string",
          description: "Target e.g. pdf, docx, txt, csv (default pdf). May include filter pdf:writer_pdf_Export",
        },
        out_dir: { type: "string" },
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
      const format = String(args.format || "pdf").replace(/^\./, "");
      const outDir = args.out_dir
        ? path.resolve(workingDir || process.cwd(), args.out_dir)
        : path.dirname(p);
      await ensureDir(outDir);
      const soffice = (await run("bash", ["-lc", "command -v soffice || command -v libreoffice"])).stdout.trim();
      if (!soffice) return errorResult("LibreOffice soffice not installed");

      const extIn = path.extname(p).toLowerCase();
      let convertTo = format;
      if (format === "pdf") {
        if ([".xls", ".xlsx", ".ods", ".csv"].includes(extIn)) convertTo = "pdf:calc_pdf_Export";
        else if ([".ppt", ".pptx", ".odp"].includes(extIn)) convertTo = "pdf:impress_pdf_Export";
        else convertTo = "pdf:writer_pdf_Export";
      }

      // Optional long-lived UNO listener: cfg.office.unoUrl e.g. socket,host=127.0.0.1,port=2002
      // and cfg.office.userInstallation (file:///path) — see docs/LIBREOFFICE_HEADLESS.md
      const unoUrl = cfg?.office?.unoUrl || process.env.XCLAW_LO_UNO_URL || "";
      const sharedInstall =
        cfg?.office?.userInstallation || process.env.XCLAW_LO_USER_INSTALLATION || "";
      let profileDir = null;
      let profileUri;
      if (unoUrl && sharedInstall) {
        profileUri = sharedInstall.startsWith("file://")
          ? sharedInstall
          : "file://" + sharedInstall;
      } else {
        profileDir = await fs.mkdtemp(path.join(os.tmpdir(), "xclaw-lo-"));
        profileUri = "file://" + profileDir;
      }
      try {
        const args = [
          "--headless",
          "--nologo",
          "--nofirststartwizard",
          "--norestore",
          `-env:UserInstallation=${profileUri}`,
        ];
        if (unoUrl) {
          args.push(`--accept=${unoUrl.includes(";") ? unoUrl : unoUrl + ";urp;StarOffice.ComponentContext"}`);
        }
        args.push("--convert-to", convertTo, "--outdir", outDir, p);
        const r = await run(soffice, args, { timeoutMs: 180_000 });
        if (r.code !== 0) {
          return errorResult(r.stderr || r.stdout || "soffice convert failed");
        }
        const outExt = convertTo.split(":")[0];
        const base = path.basename(p, path.extname(p));
        const expected = path.join(outDir, `${base}.${outExt}`);
        let exists = false;
        let size = 0;
        try {
          const raw = await fs.readFile(expected);
          exists = raw.length > 0;
          size = raw.length;
          if (!looksLikeConvertedDocument(raw, convertTo)) {
            return errorResult(
              `soffice output is not a ${outExt} document (${raw.length} bytes): ${expected}`
            );
          }
        } catch {
          /* */
        }
        if (!exists) {
          return errorResult(
            `soffice exited 0 but output missing: ${expected}\n${r.stdout || r.stderr}`
          );
        }
        return textResult(`Converted → ${expected} (${size} bytes)`, {
          metadata: {
            input: p,
            output: expected,
            format: convertTo,
            size,
          },
        });
      } finally {
        if (profileDir) {
          await fs.rm(profileDir, { recursive: true, force: true }).catch(() => {});
        }
      }
    },
  };
}

export function createViewImageTool({ workingDir }) {
  return {
    name: "view_image",
    description:
      "Describe an image file using available vision: prefers file metadata + optional OCR. For full vision, set XAI_API_KEY (chat with image if provider supports).",
    parameters: {
      type: "object",
      properties: {
        path: { type: "string" },
        with_ocr: { type: "boolean", description: "Also run tesseract OCR (default true)" },
      },
      required: ["path"],
    },
    async execute(args = {}) {
      const p = path.resolve(workingDir || process.cwd(), String(args.path || ""));
      try {
        const st = await fs.stat(p);
        const mag = await run("magika", ["-j", p], { timeoutMs: 10_000 });
        const id = await run("identify", ["-format", "%m %wx%h %b", p], { timeoutMs: 10_000 });
        const idOk = id.code === 0 && String(id.stdout || "").trim();
        const magOk = mag.code === 0 && String(mag.stdout || "").trim();
        if (!idOk && !magOk) {
          return errorResult(
            `view_image: identify and magika both failed for ${p} (identify ${id.code}, magika ${mag.code})`
          );
        }
        const lines = [
          `path: ${p}`,
          `size: ${st.size} bytes`,
          `identify: ${idOk || "n/a"}`,
          `magika: ${magOk || "n/a"}`,
        ];
        if (args.with_ocr !== false) {
          const ocrTool = createOcrTool({ workingDir });
          const o = await ocrTool.execute({ path: p, max_chars: 4000 });
          if (!o.isError) {
            lines.push("ocr:", o.content[0].text.slice(0, 2000));
          }
        }
        // Optional xAI vision if key + small image
        const key = process.env.XAI_API_KEY || process.env.XCLAW_API_KEY;
        if (key && st.size < 4_000_000) {
          try {
            const buf = await fs.readFile(p);
            const b64 = buf.toString("base64");
            const mime =
              p.endsWith(".png") ? "image/png" : p.endsWith(".webp") ? "image/webp" : "image/jpeg";
            const visionModels = [
              process.env.XCLAW_VISION_MODEL,
              "grok-2-vision-1212",
              "grok-2-vision",
              "grok-4",
            ].filter(Boolean);
            let visionOk = false;
            for (const model of visionModels) {
              const res = await fetch("https://api.x.ai/v1/chat/completions", {
                method: "POST",
                headers: {
                  Authorization: `Bearer ${key}`,
                  "Content-Type": "application/json",
                },
                body: JSON.stringify({
                  model,
                  messages: [
                    {
                      role: "user",
                      content: [
                        { type: "text", text: "Describe this image concisely: subjects, text, setting." },
                        { type: "image_url", image_url: { url: `data:${mime};base64,${b64}` } },
                      ],
                    },
                  ],
                  max_tokens: 400,
                }),
                signal: AbortSignal.timeout(60_000),
              });
              if (res.ok) {
                const j = await res.json();
                const desc = j.choices?.[0]?.message?.content;
                if (desc) {
                  lines.push(`vision (${model}):`, desc);
                  visionOk = true;
                  break;
                }
              }
            }
            if (!visionOk) lines.push("vision: no successful model response");
          } catch (e) {
            lines.push(`vision: ${e.message}`);
          }
        }
        return textResult(lines.join("\n"));
      } catch (e) {
        return errorResult(e.message);
      }
    },
  };
}

export function createMediaTools(ctx = {}) {
  const workingDir = ctx.workingDir || process.cwd();
  return [
    createOcrTool({ workingDir }),
    createOfficeConvertTool({ workingDir, cfg: ctx.cfg }),
    createViewImageTool({ workingDir }),
  ];
}
