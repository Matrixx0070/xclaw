/**
 * Image search / generate / edit / helpers — robust multi-backend.
 */
import fs from "node:fs/promises";
import path from "node:path";
import crypto from "node:crypto";
import { spawn } from "node:child_process";
import { resolveImagineMatrix } from "../media/imagine-models.mjs";
import { resolveProviderToken } from "../auth/profiles.mjs";

/**
 * xAI credential for the images API. Prefers the provider credential store
 * (xai:apikey / xai:oauth — configured via `xclaw providers`), so image
 * generation uses the same key as chat instead of a separate XAI_API_KEY env
 * var. Env vars stay as a fallback for legacy/CI setups.
 */
async function resolveXaiKey(cfg = {}) {
  try {
    const tok = await resolveProviderToken(cfg, "xai", {});
    if (tok?.token) return tok.token;
  } catch {
    /* fall through to env */
  }
  return process.env.XAI_API_KEY || process.env.XCLAW_API_KEY || "";
}

function textResult(text, extra = {}) {
  return { content: [{ type: "text", text: String(text ?? "") }], ...extra };
}
function errorResult(msg) {
  return { isError: true, content: [{ type: "text", text: String(msg) }] };
}

export async function assertImageLanded(dest, minBytes = 100) {
  let written;
  try {
    written = await fs.readFile(dest);
  } catch {
    throw new Error(`image file missing: ${dest}`);
  }
  if (written.length < minBytes) {
    throw new Error(`image too small (${written.length} bytes): ${dest}`);
  }
  return written.length;
}

async function downloadTo(url, dest, headers = {}) {
  const res = await fetch(url, {
    headers: { "User-Agent": "XClaw/2.8", ...headers },
    signal: AbortSignal.timeout(45_000),
    redirect: "follow",
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const buf = Buffer.from(await res.arrayBuffer());
  if (buf.length < 100) throw new Error("download too small");
  await fs.writeFile(dest, buf);
  return { bytes: buf.length, contentType: res.headers.get("content-type") };
}

function runConvert(args) {
  return new Promise((resolve) => {
    const c = spawn("convert", args);
    let err = "";
    c.stderr.on("data", (d) => (err += d));
    c.on("close", (code) => resolve({ code: code ?? 0, err }));
    c.on("error", (e) => resolve({ code: -1, err: e.message }));
  });
}

/** P1.2 stronger search */
export function createSearchImagesTool({ workingDir }) {
  return {
    name: "search_images",
    description:
      "Search images and save to artifacts/images/. Backends: Bing (BING_SEARCH_KEY), SerpAPI (SERPAPI_API_KEY), Openverse, Unsplash source.",
    parameters: {
      type: "object",
      properties: {
        query: { type: "string" },
        count: { type: "number" },
      },
      required: ["query"],
    },
    async execute(args = {}) {
      const query = String(args.query || "").trim();
      if (!query) return errorResult("query required");
      const count = Math.min(Math.max(Number(args.count) || 3, 1), 8);
      const outDir = path.join(workingDir || process.cwd(), "artifacts", "images");
      await fs.mkdir(outDir, { recursive: true });
      const results = [];
      const tried = [];

      // 1) Bing Image Search API
      const bingKey = process.env.BING_SEARCH_KEY || process.env.AZURE_BING_KEY;
      if (bingKey && results.length < count) {
        tried.push("bing");
        try {
          const u = new URL("https://api.bing.microsoft.com/v7.0/images/search");
          u.searchParams.set("q", query);
          u.searchParams.set("count", String(count));
          u.searchParams.set("safeSearch", "Moderate");
          const res = await fetch(u, {
            headers: { "Ocp-Apim-Subscription-Key": bingKey },
            signal: AbortSignal.timeout(20_000),
          });
          if (res.ok) {
            const j = await res.json();
            for (const item of j.value || []) {
              if (results.length >= count) break;
              const url = item.contentUrl || item.thumbnailUrl;
              if (!url) continue;
              const id = crypto.randomBytes(4).toString("hex");
              const ext = (url.match(/\.(jpg|jpeg|png|webp|gif)/i) || [, "jpg"])[1].toLowerCase();
              const dest = path.join(outDir, `img_${id}.${ext}`);
              try {
                await downloadTo(url, dest);
                results.push({
                  title: item.name || query,
                  path: dest,
                  url,
                  source: "bing",
                });
              } catch {
                /* */
              }
            }
          }
        } catch {
          /* */
        }
      }

      // 2) SerpAPI Google Images
      const serp = process.env.SERPAPI_API_KEY;
      if (serp && results.length < count) {
        tried.push("serpapi");
        try {
          const u = new URL("https://serpapi.com/search.json");
          u.searchParams.set("engine", "google_images");
          u.searchParams.set("q", query);
          u.searchParams.set("api_key", serp);
          const res = await fetch(u, { signal: AbortSignal.timeout(25_000) });
          if (res.ok) {
            const j = await res.json();
            for (const item of j.images_results || []) {
              if (results.length >= count) break;
              const url = item.original || item.thumbnail;
              if (!url) continue;
              const id = crypto.randomBytes(4).toString("hex");
              const dest = path.join(outDir, `img_${id}.jpg`);
              try {
                await downloadTo(url, dest);
                results.push({
                  title: item.title || query,
                  path: dest,
                  url,
                  source: "serpapi",
                });
              } catch {
                /* */
              }
            }
          }
        } catch {
          /* */
        }
      }

      // 3) Openverse
      if (results.length < count) {
        tried.push("openverse");
        try {
          const ov = `https://api.openverse.engineering/v1/images/?q=${encodeURIComponent(query)}&page_size=${count}`;
          const res = await fetch(ov, {
            headers: { Accept: "application/json", "User-Agent": "XClaw/2.8" },
            signal: AbortSignal.timeout(20_000),
          });
          if (res.ok) {
            const j = await res.json();
            for (const item of j.results || []) {
              if (results.length >= count) break;
              const url = item.url || item.thumbnail;
              if (!url) continue;
              const id = crypto.randomBytes(4).toString("hex");
              const ext = (url.match(/\.(jpg|jpeg|png|webp|gif)/i) || [, "jpg"])[1];
              const dest = path.join(outDir, `img_${id}.${ext}`);
              try {
                await downloadTo(url, dest);
                results.push({
                  title: item.title || query,
                  path: dest,
                  url,
                  source: "openverse",
                });
              } catch {
                /* */
              }
            }
          }
        } catch {
          /* */
        }
      }

      // 4) Unsplash Source fallback
      if (!results.length) {
        tried.push("unsplash");
        for (let i = 0; i < count; i++) {
          const id = crypto.randomBytes(4).toString("hex");
          const dest = path.join(outDir, `img_${id}.jpg`);
          try {
            await downloadTo(
              `https://source.unsplash.com/960x640/?${encodeURIComponent(query)}&sig=${id}`,
              dest
            );
            results.push({ title: query, path: dest, url: "unsplash", source: "unsplash" });
          } catch {
            break;
          }
        }
      }

      if (!results.length) {
        return errorResult(`No images for "${query}" (tried: ${tried.join(", ")})`);
      }
      const lines = results.map(
        (r, i) => `${i + 1}. ${r.title}\n   path: ${r.path}\n   source: ${r.source}\n   url: ${r.url}`
      );
      return textResult(lines.join("\n\n"), {
        metadata: { count: results.length, tried, results },
      });
    },
  };
}

/** P1.3 generate_image */
export function createGenerateImageTool({ workingDir, cfg }) {
  return {
    name: "generate_image",
    description:
      "Generate image from prompt via the xAI images API (uses the configured xai provider credential). Saves under artifacts/imagine_images/.",
    parameters: {
      type: "object",
      properties: {
        prompt: { type: "string" },
        orientation: { type: "string" },
        model: { type: "string" },
      },
      required: ["prompt"],
    },
    async execute(args = {}) {
      const prompt = String(args.prompt || "").trim();
      if (!prompt) return errorResult("prompt required");
      const key = await resolveXaiKey(cfg);
      if (!key) {
        return errorResult(
          "No xAI credential for image generation. Add one with `xclaw providers set --provider xai --api-key <key>` (or `xclaw providers oauth --provider xai`). Falls back to search_images."
        );
      }
      const outDir = path.join(workingDir || process.cwd(), "artifacts", "imagine_images");
      await fs.mkdir(outDir, { recursive: true });
      const matrix = resolveImagineMatrix({});
      const models = [...new Set([args.model, ...matrix.models].filter(Boolean))];
      const endpoints = matrix.endpoints;
      const errors = [];
      for (const model of models) {
        for (const url of endpoints) {
          try {
            const res = await fetch(url, {
              method: "POST",
              headers: {
                Authorization: `Bearer ${key}`,
                "Content-Type": "application/json",
              },
              body: JSON.stringify({
                model,
                prompt,
                n: 1,
                response_format: matrix.responseFormat || "b64_json",
              }),
              signal: AbortSignal.timeout(180_000),
            });
            const j = await res.json().catch(() => ({}));
            if (!res.ok) {
              errors.push(`${model}@${url}: HTTP ${res.status} ${j.error || j.message || ""}`);
              continue;
            }
            const id = crypto.randomBytes(5).toString("hex");
            const dest = path.join(outDir, `gen_${id}.png`);
            if (j.data?.[0]?.b64_json) {
              const buf = Buffer.from(j.data[0].b64_json, "base64");
              if (buf.length < 100) {
                errors.push(`${model}: image payload too small (${buf.length} bytes)`);
                continue;
              }
              await fs.writeFile(dest, buf);
              const bytes = await assertImageLanded(dest);
              if (bytes !== buf.length) {
                errors.push(`${model}: write verification failed`);
                continue;
              }
              return textResult(`Generated: ${dest}`, {
                metadata: { path: dest, model, prompt, bytes },
              });
            }
            if (j.data?.[0]?.url) {
              const dl = await downloadTo(j.data[0].url, dest, { Authorization: `Bearer ${key}` });
              const written = await fs.readFile(dest);
              if (written.length < 100 || written.length !== dl.bytes) {
                errors.push(`${model}: download verification failed`);
                continue;
              }
              return textResult(`Generated: ${dest}`, {
                metadata: { path: dest, model, prompt, url: j.data[0].url, bytes: written.length },
              });
            }
            errors.push(`${model}: no image payload`);
          } catch (e) {
            errors.push(`${model}: ${e.message}`);
          }
        }
      }
      return errorResult(
        `Image generation failed. Tried models: ${models.join(", ")}.\n` +
          errors.slice(0, 8).join("\n") +
          "\nFallback: search_images with a descriptive query."
      );
    },
  };
}

/** P1.4 edit_image — semantic via API if possible, else structured Magick ops from prompt keywords */
export function createEditImageTool({ workingDir, cfg }) {
  return {
    name: "edit_image",
    description:
      "Edit an image. Tries xAI image edit API when available; otherwise applies ImageMagick ops inferred from prompt (grayscale, blur, rotate, resize, negate, sharpen).",
    parameters: {
      type: "object",
      properties: {
        path: { type: "string" },
        prompt: { type: "string" },
        op: { type: "string" },
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
      const prompt = String(args.prompt || "").toLowerCase();
      const outDir = path.join(workingDir || process.cwd(), "artifacts", "imagine_images");
      await fs.mkdir(outDir, { recursive: true });
      const id = crypto.randomBytes(4).toString("hex");
      const dest = path.join(outDir, `edit_${id}${path.extname(p) || ".png"}`);

      // Try API edit (OpenAI-style images/edits) if a credential resolves
      const key = await resolveXaiKey(cfg);
      if (key && args.prompt) {
        try {
          // Many providers lack edits; attempt once
          const res = await fetch("https://api.x.ai/v1/images/edits", {
            method: "POST",
            headers: {
              Authorization: `Bearer ${key}`,
              "Content-Type": "application/json",
            },
            body: JSON.stringify({
              model: process.env.XCLAW_IMAGE_MODEL || "grok-2-image",
              prompt: args.prompt,
              image: p,
            }),
            signal: AbortSignal.timeout(60_000),
          });
          if (res.ok) {
            const j = await res.json();
            if (j.data?.[0]?.b64_json) {
              const buf = Buffer.from(j.data[0].b64_json, "base64");
              if (buf.length < 100) throw new Error(`image payload too small (${buf.length} bytes)`);
              await fs.writeFile(dest, buf);
              const bytes = await assertImageLanded(dest);
              return textResult(`API edit saved: ${dest}`, {
                metadata: { path: dest, engine: "xai", bytes },
              });
            }
          }
        } catch {
          /* fall through */
        }
      }

      let op = String(args.op || "").toLowerCase();
      if (!op) {
        if (/gray|grey|black.?white|mono/.test(prompt)) op = "grayscale";
        else if (/blur|soft/.test(prompt)) op = "blur";
        else if (/rotate|turn/.test(prompt)) op = "rotate90";
        else if (/negat|invert/.test(prompt)) op = "negate";
        else if (/sharp/.test(prompt)) op = "sharpen";
        else if (/resize|smaller|thumbnail|scale/.test(prompt)) op = "resize";
        else if (/bright/.test(prompt)) op = "brighten";
        else op = "auto-level";
      }

      const im = [p];
      if (op === "grayscale") im.push("-colorspace", "Gray");
      else if (op === "blur") im.push("-blur", "0x3");
      else if (op === "negate") im.push("-negate");
      else if (op === "rotate90") im.push("-rotate", "90");
      else if (op === "resize") im.push("-resize", "1024x1024>");
      else if (op === "sharpen") im.push("-sharpen", "0x1.2");
      else if (op === "brighten") im.push("-modulate", "110,100,100");
      else im.push("-auto-level");
      im.push(dest);
      const r = await runConvert(im);
      if (r.code !== 0) return errorResult(r.err || "convert failed");
      try {
        await assertImageLanded(dest);
      } catch (e) {
        return errorResult(`convert reported success but ${e.message}`);
      }
      return textResult(
        `Edited: ${dest}\nengine: imagemagick op=${op}` +
          (args.prompt ? `\nprompt: ${args.prompt}` : "") +
          (key ? "\n(note: semantic API edit unavailable or failed; used local op)" : ""),
        { metadata: { path: dest, source: p, op, engine: "imagemagick" } }
      );
    },
  };
}

export function createImageTools(ctx = {}) {
  const workingDir = ctx.workingDir || process.cwd();
  const cfg = ctx.cfg || {};
  return [
    createSearchImagesTool({ workingDir }),
    createGenerateImageTool({ workingDir, cfg }),
    createEditImageTool({ workingDir, cfg }),
  ];
}
