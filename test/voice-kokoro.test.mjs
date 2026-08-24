/**
 * Kokoro TTS integration in localSpeak — hermetic: fake CLI scripts stand in
 * for the real /opt/kokoro/speak.py, so CI needs no model or python.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, chmodSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { localConfig, localSpeak } from "../src/voice/providers/local.mjs";

function fakeTtsBin(dir, name, { fail = false, log = null } = {}) {
  const p = join(dir, name);
  const body = fail
    ? "#!/bin/sh\nexit 1\n"
    : `#!/bin/sh\n${log ? `echo "$@" > ${log}\n` : ""}out=""\nprev=""\nfor a in "$@"; do [ "$prev" = "--output_file" ] && out="$a"; [ "$prev" = "-w" ] && out="$a"; prev="$a"; done\ncat > /dev/null\nprintf 'RIFFfake' > "$out"\n`;
  writeFileSync(p, body);
  chmodSync(p, 0o755);
  return p;
}

describe("kokoro localSpeak integration", () => {
  it("localConfig resolves flat voice.kokoro* keys with af_heart default", () => {
    const c = localConfig({ voice: { kokoroBin: "/opt/kokoro/speak.py" } });
    assert.equal(c.kokoroBin, "/opt/kokoro/speak.py");
    assert.equal(c.kokoroVoice, "af_heart");
    const c2 = localConfig({ voice: { kokoroBin: "/x", kokoroVoice: "am_michael" } });
    assert.equal(c2.kokoroVoice, "am_michael");
    assert.equal(localConfig({}).kokoroBin, "", "kokoro off unless configured");
  });

  it("kokoro is preferred over piper and passes --voice", async () => {
    const dir = mkdtempSync(join(tmpdir(), "kokoro-"));
    const log = join(dir, "args.log");
    const kokoro = fakeTtsBin(dir, "kokoro", { log });
    const piper = fakeTtsBin(dir, "piper");
    const out = await localSpeak("hello", {
      voice: { kokoroBin: kokoro, kokoroVoice: "am_michael", piperBin: piper, piperModel: "/m.onnx" },
    });
    assert.equal(out.ok, true);
    assert.equal(out.provider, "kokoro");
    assert.equal(out.voice, "am_michael");
    const { readFileSync } = await import("node:fs");
    assert.match(readFileSync(log, "utf8"), /--voice am_michael/);
  });

  it("kokoro failure falls back to piper, then espeak", async () => {
    const dir = mkdtempSync(join(tmpdir(), "kokoro-"));
    const badKokoro = fakeTtsBin(dir, "kokoro", { fail: true });
    const piper = fakeTtsBin(dir, "piper");
    const out = await localSpeak("hello", {
      voice: { kokoroBin: badKokoro, piperBin: piper, piperModel: "/m.onnx" },
    });
    assert.equal(out.ok, true);
    assert.equal(out.provider, "piper", "must fall through to piper on kokoro failure");

    const badPiper = fakeTtsBin(dir, "piper2", { fail: true });
    const espeak = fakeTtsBin(dir, "espeak");
    const out2 = await localSpeak("hello", {
      voice: { kokoroBin: badKokoro, piperBin: badPiper, piperModel: "/m.onnx", espeakBin: espeak },
    });
    assert.equal(out2.ok, true);
    assert.equal(out2.provider, "espeak-ng");
  });
});
