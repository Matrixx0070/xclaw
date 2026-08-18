/**
 * Voice capture / wake checks for xclaw doctor.
 * Kept separate so doctor.mjs stays stable across large voice probe changes.
 */
export async function pushVoiceWakeAndCapture(push, cfg) {
  try {
    const { probeWakeStack } = await import("../voice/wake/index.mjs");
    const w = await probeWakeStack(cfg);
    const cap = w.capture || null;
    const capParts = [
      `backend=${cap?.backend || "none"}`,
      `ok=${Boolean(cap?.ok)}`,
      cap?.monitorRejected ? "monitor=rejected" : null,
      cap?.pulse?.onPipeWire ? "pulse=pipewire" : cap?.pulse?.ok ? "pulse=ok" : null,
      cap?.wireplumber?.ok ? "wp=ok" : null,
      cap?.arecord?.cards?.length != null
        ? `alsa_cards=${cap.arecord.cards.length}`
        : null,
      cap?.defaultSource?.name
        ? `src=${String(cap.defaultSource.name).slice(0, 48)}`
        : null,
    ].filter(Boolean);
    push(
      "voice.capture",
      cap?.ok && !cap?.monitorRejected ? "ok" : "warn",
      capParts.join(" ") || "capture probe empty",
      cap
        ? {
            backend: cap.backend,
            target: cap.target,
            monitorRejected: cap.monitorRejected,
            errors: cap.errors,
            recordHint: cap.recordHint,
          }
        : undefined
    );
    push(
      "voice.wake",
      w.readyForW1 ? "ok" : "warn",
      `readyForW1=${Boolean(w.readyForW1)} phrases=${(w.phrases || []).length} arecord=${w.arecord?.ok} stt=${w.stt?.ok} oww=${w.openWakeWord?.ok} capture=${cap?.ok && !cap?.monitorRejected}`
    );
  } catch (e) {
    push("voice.capture", "warn", e.message || String(e));
    push("voice.wake", "warn", e.message || String(e));
  }
}
