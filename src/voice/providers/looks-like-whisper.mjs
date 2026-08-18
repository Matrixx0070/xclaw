/** True only when a real STT binary responded — not spawn ENOENT text matching /whisper/. */
export function looksLikeWhisperCli(wh) {
  if (!wh) return false;
  if (wh.errorCode === "ENOENT" || wh.code === 127) return false;
  if (wh.spawnError) return false;
  const text = `${wh.stderr || ""}${wh.stdout?.toString?.() || ""}`;
  if (/ENOENT|not found|No such file/i.test(text) && /spawn/i.test(text)) return false;
  return wh.code === 0 || /usage:|whisper\.cpp|--model|transcription/i.test(text);
}
