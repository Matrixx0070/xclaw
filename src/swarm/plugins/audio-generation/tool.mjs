/**
 * Audio Generation Tool — REAL local text-to-speech via xclaw's voice
 * pipeline (localSpeak: piper neural TTS when configured, espeak-ng
 * fallback). No cloud APIs, no keys — audio is synthesized on this host and
 * saved under the swarm workspace.
 */
import { mkdirSync, copyFileSync, statSync, unlinkSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";

const OUT_DIR = join(homedir(), ".xclaw", "workspaces", "swarm-ext", "artifacts", "audio");

export class AudioGenerationTool {
  constructor({ speakImpl, cfgLoader, outDir } = {}) {
    this.name = "audio_generation";
    this.description =
      "Generate REAL speech audio from text using the local TTS engine (piper neural voice, espeak-ng fallback). Saves a WAV file on this machine and returns its path, provider, and size. Max 500 chars per call.";
    this._speak = speakImpl || null;
    this._cfgLoader = cfgLoader || null;
    this._outDir = outDir || OUT_DIR;
    this.parameters = {
      text: { type: "string", description: "Text to speak (max 500 chars)", required: true },
      filename: { type: "string", description: "Optional output filename (without extension)" },
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
            text: { type: "string", description: "Text to synthesize into speech" },
            filename: { type: "string", description: "Optional output name (letters/digits/dash only)" },
          },
          required: ["text"],
        },
      },
    };
  }

  async _loadDeps() {
    if (!this._speak) {
      const { localSpeak } = await import("../../../voice/providers/local.mjs");
      this._speak = localSpeak;
    }
    if (!this._cfgLoader) {
      const { loadConfig } = await import("../../../config/load.mjs");
      this._cfgLoader = loadConfig;
    }
  }

  async execute({ text, filename } = {}) {
    try {
      const t = String(text || "").trim();
      if (!t) return { success: false, error: "text required" };
      if (t.length > 500) {
        return { success: false, error: `text too long (${t.length} chars, max 500) — split into multiple calls` };
      }
      await this._loadDeps();
      const cfg = await this._cfgLoader();
      const spoken = await this._speak(t, cfg || {});
      if (!spoken?.ok) {
        return {
          success: false,
          error: `TTS failed: ${spoken?.error || "unknown"} (provider=${spoken?.provider || "none"})`,
        };
      }
      // Move out of tmp into the swarm workspace so the file survives and is
      // reachable by file tools.
      mkdirSync(this._outDir, { recursive: true });
      const safe = String(filename || `speech-${Date.now()}`).replace(/[^A-Za-z0-9_-]/g, "").slice(0, 60) || `speech-${Date.now()}`;
      const dest = join(this._outDir, `${safe}.wav`);
      copyFileSync(spoken.path, dest);
      try {
        unlinkSync(spoken.path);
      } catch {
        /* tmp cleanup is best-effort */
      }
      const bytes = statSync(dest).size;
      return {
        success: true,
        data: {
          path: dest,
          format: "wav",
          bytes,
          provider: spoken.provider,
          chars: t.length,
          source: `local TTS (${spoken.provider}) — synthesized on this host`,
        },
      };
    } catch (e) {
      return { success: false, error: e.message };
    }
  }
}
