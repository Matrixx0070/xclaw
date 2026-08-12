/**
 * Grok seat built-in providers (already available — no Ollama/paid install).
 *
 * TTS:  connected Voice tool (voice_generate_speech)
 * LLM:  host agent / XCLAW_MODEL when running under Grok computer
 *
 * This is what exists ON THIS SEAT — not a separate local install.
 */

export const SEAT_VOICES = [
  "ara", "eve", "luna", "celeste", "carina", "iris", "ursa",
  "leo", "orion", "rex", "sirius", "atlas", "helios", "cosmo",
];

export const DEFAULT_SEAT_VOICE = "ara";

/**
 * Speak via seat Voice capability.
 * In-process note: call sites running inside Grok computer use
 * call_connected_tool('voice_generate_speech', …).
 * This module documents the contract and builds args.
 */
export function buildSeatSpeakArgs(text, opts = {}) {
  const dest =
    opts.destPath ||
    `artifacts/xclaw-voice-${Date.now()}.mp3`;
  return {
    text: String(text || "").slice(0, 15000),
    voice: opts.voice || DEFAULT_SEAT_VOICE,
    language: opts.language || "auto",
    dest_path: dest.endsWith(".mp3") ? dest : `${dest}.mp3`,
    with_timestamps: Boolean(opts.withTimestamps),
  };
}

export function listSeatVoices() {
  return SEAT_VOICES.map((id) => ({ voice_id: id }));
}
