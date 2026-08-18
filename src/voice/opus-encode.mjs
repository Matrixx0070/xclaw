/**
 * O2 — Encode PCM to Opus packets for /ws/voice edge transport.
 *
 * Uses opusscript or @discordjs/opus when installed; otherwise returns
 * { ok:false } so callers fall back to PCM.
 */

/**
 * Probe encode backends.
 */
export async function probeOpusEncode() {
  const out = {
    opusscript: { ok: false },
    discordjsOpus: { ok: false },
  };
  try {
    await import("opusscript");
    out.opusscript = { ok: true };
  } catch (e) {
    out.opusscript = { ok: false, error: e.message };
  }
  try {
    await import("@discordjs/opus");
    out.discordjsOpus = { ok: true };
  } catch (e) {
    out.discordjsOpus = { ok: false, error: e.message };
  }
  out.ready = out.opusscript.ok || out.discordjsOpus.ok;
  return out;
}

/**
 * Encode S16_LE mono PCM buffer into Opus packets (default 20ms frames).
 * @param {Buffer} pcm
 * @param {{ sampleRate?: number, channels?: number, frameMs?: number }} [opts]
 * @returns {Promise<{ ok: boolean, packets?: Buffer[], provider?: string, error?: string }>}
 */
export async function encodePcmToOpusPackets(pcm, opts = {}) {
  const sampleRate = opts.sampleRate || 16000;
  const channels = opts.channels || 1;
  const frameMs = opts.frameMs || 20;
  const frameSamples = Math.floor((sampleRate * frameMs) / 1000) * channels;
  const frameBytes = frameSamples * 2;
  if (!pcm?.length) {
    return { ok: false, error: "empty_pcm" };
  }

  const packets = [];

  // opusscript
  try {
    const mod = await import("opusscript");
    const OpusScript = mod.default || mod;
    const enc = new OpusScript(
      sampleRate,
      channels,
      OpusScript.Application?.VOIP ?? 2048
    );
    for (let off = 0; off + frameBytes <= pcm.length; off += frameBytes) {
      const frame = pcm.subarray(off, off + frameBytes);
      const pkt = enc.encode(frame, frameSamples);
      if (pkt) packets.push(Buffer.from(pkt));
    }
    if (packets.length) {
      return { ok: true, packets, provider: "opusscript", frameMs };
    }
  } catch {
    /* next */
  }

  // @discordjs/opus
  try {
    const mod = await import("@discordjs/opus");
    const { OpusEncoder } = mod;
    const enc = new OpusEncoder(sampleRate, channels);
    for (let off = 0; off + frameBytes <= pcm.length; off += frameBytes) {
      const frame = pcm.subarray(off, off + frameBytes);
      const pkt = enc.encode(frame);
      if (pkt) packets.push(Buffer.from(pkt));
    }
    if (packets.length) {
      return { ok: true, packets, provider: "@discordjs/opus", frameMs };
    }
  } catch {
    /* */
  }

  return {
    ok: false,
    error: "no Opus encoder (npm i opusscript or @discordjs/opus)",
  };
}

/**
 * Strip WAV header if present → raw PCM.
 */
export function wavToPcm(buf) {
  if (!buf || buf.length < 44) return buf;
  if (buf.toString("utf8", 0, 4) === "RIFF" && buf.toString("utf8", 8, 12) === "WAVE") {
    // Find data chunk
    let off = 12;
    while (off + 8 <= buf.length) {
      const id = buf.toString("utf8", off, off + 4);
      const size = buf.readUInt32LE(off + 4);
      if (id === "data") {
        return buf.subarray(off + 8, off + 8 + size);
      }
      off += 8 + size;
    }
    return buf.subarray(44);
  }
  return buf;
}

export default {
  probeOpusEncode,
  encodePcmToOpusPackets,
  wavToPcm,
};
