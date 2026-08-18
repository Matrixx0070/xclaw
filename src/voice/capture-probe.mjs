/**
 * Multi-backend capture device probe for XClaw wake / doctor.
 */
import { spawn } from "node:child_process";
import {
  looksLikeMonitorSource,
  parseArecordList,
  parseWpctlStatus,
  parseWpctlInspect,
  parsePactlInfo,
  parsePactlDefaultSource,
  parsePactlSourcesShort,
} from "./capture-parsers.mjs";

export {
  looksLikeMonitorSource,
  parseArecordList,
  parseWpctlStatus,
  parseWpctlInspect,
  parsePactlInfo,
  parsePactlDefaultSource,
  parsePactlSourcesShort,
} from "./capture-parsers.mjs";

function run(cmd, args, opts = {}) {
  return new Promise((resolve) => {
    const child = spawn(cmd, args, {
      stdio: ["ignore", "pipe", "pipe"],
      env: { ...process.env, ...(opts.env || {}) },
    });
    let stdout = "";
    let stderr = "";
    child.stdout?.on("data", (d) => (stdout += d));
    child.stderr?.on("data", (d) => (stderr += d));
    child.on("error", (err) =>
      resolve({
        code: err.code === "ENOENT" ? 127 : 1,
        stdout,
        stderr: err.message || String(err),
        errorCode: err.code || null,
      })
    );
    child.on("close", (code) =>
      resolve({ code: code ?? 1, stdout, stderr, errorCode: null })
    );
  });
}

/**
 * Full multi-backend capture probe.
 * Order: explicit → WirePlumber → pulse → pipewire-alsa → alsa
 */
export async function probeCapture(opts = {}) {
  const explicit =
    opts.target ||
    process.env.XCLAW_CAPTURE_TARGET ||
    process.env.PIPEWIRE_NODE ||
    null;

  const out = {
    ok: false,
    backend: null,
    target: explicit,
    explicit: Boolean(explicit),
    arecord: { ok: false, cards: [] },
    pipewire: { ok: false },
    wireplumber: { ok: false, defaultSource: null },
    pulse: { ok: false, defaultSource: null },
    defaultSource: null,
    monitorRejected: false,
    recordHint: null,
    errors: [],
  };

  const arVer = await run("arecord", ["--version"]);
  const arMissing =
    arVer.errorCode === "ENOENT" ||
    arVer.code === 127 ||
    (/ENOENT|not found/i.test(arVer.stderr) && /spawn/i.test(arVer.stderr));
  if (arMissing) {
    out.arecord = { ok: false, error: "arecord not found (alsa-utils)", cards: [] };
    out.errors.push("arecord missing");
  } else {
    const list = await run("arecord", ["-l"]);
    const cards = parseArecordList(`${list.stdout || ""}\n${list.stderr || ""}`);
    out.arecord = {
      ok: cards.length > 0,
      cards,
      error: cards.length === 0 ? "arecord -l found no capture cards" : undefined,
    };
    if (cards.length === 0) out.errors.push("no ALSA capture cards");
  }

  const pw = await run("pw-cli", ["info", "0"]);
  const pwOk =
    !(pw.errorCode === "ENOENT" || pw.code === 127) &&
    (pw.code === 0 || /PipeWire|core/i.test(pw.stdout + pw.stderr));
  out.pipewire = pwOk
    ? { ok: true }
    : {
        ok: false,
        error:
          pw.errorCode === "ENOENT" || pw.code === 127
            ? "pw-cli not found"
            : "PipeWire not reachable",
      };

  const wpStatus = await run("wpctl", ["status"]);
  if (
    wpStatus.errorCode === "ENOENT" ||
    wpStatus.code === 127 ||
    (/ENOENT|not found/i.test(wpStatus.stderr) && /spawn/i.test(wpStatus.stderr))
  ) {
    out.wireplumber = { ok: false, error: "wpctl not found", defaultSource: null };
  } else if (wpStatus.code !== 0 && !/Audio/i.test(wpStatus.stdout)) {
    out.wireplumber = {
      ok: false,
      error: wpStatus.stderr?.trim() || "wpctl status failed",
      defaultSource: null,
    };
  } else {
    const parsed = parseWpctlStatus(wpStatus.stdout || "");
    let inspect = null;
    if (parsed.defaultSource) {
      const ins = await run("wpctl", ["inspect", String(parsed.defaultSource.id)]);
      inspect = parseWpctlInspect(`${ins.stdout}\n${ins.stderr}`);
    } else {
      const ins = await run("wpctl", ["inspect", "@DEFAULT_AUDIO_SOURCE@"]);
      if (ins.code === 0 || /node\.name|media\.class/i.test(ins.stdout)) {
        inspect = parseWpctlInspect(`${ins.stdout}\n${ins.stderr}`);
        parsed.defaultSource = {
          id: null,
          name: inspect.description || inspect.nodeName || "DEFAULT_AUDIO_SOURCE",
          isDefault: true,
          looksLikeMonitor: inspect.looksLikeMonitor,
        };
      }
    }
    const ds = parsed.defaultSource;
    const monitor =
      (ds && ds.looksLikeMonitor) || (inspect && inspect.looksLikeMonitor) || false;
    const muted = inspect?.mute === true;
    out.wireplumber = {
      ok: Boolean(ds) && !monitor && !muted,
      defaultSource: ds
        ? {
            id: ds.id,
            name: ds.name,
            nodeName: inspect?.nodeName || null,
            mediaClass: inspect?.mediaClass || null,
            mute: muted,
            looksLikeMonitor: monitor,
          }
        : null,
      sources: parsed.sources.slice(0, 12),
      error: !ds
        ? "no default Audio/Source"
        : monitor
          ? "default source looks like a sink monitor"
          : muted
            ? "default source is muted"
            : undefined,
    };
    out.defaultSource = out.wireplumber.defaultSource;
    if (monitor) {
      out.monitorRejected = true;
      out.errors.push("default source is a monitor");
    }
    if (muted) out.errors.push("default source muted");
  }

  const pactlInfo = await run("pactl", ["info"]);
  if (
    pactlInfo.errorCode === "ENOENT" ||
    pactlInfo.code === 127 ||
    (/ENOENT|not found/i.test(pactlInfo.stderr) && /spawn/i.test(pactlInfo.stderr))
  ) {
    out.pulse = { ok: false, error: "pactl not found", defaultSource: null };
  } else if (pactlInfo.code !== 0 && !/Server Name:/i.test(pactlInfo.stdout)) {
    out.pulse = {
      ok: false,
      error: pactlInfo.stderr?.trim() || "pactl info failed",
      defaultSource: null,
    };
  } else {
    const info = parsePactlInfo(pactlInfo.stdout || "");
    let sourceName = info.defaultSource;
    if (!sourceName) {
      const gd = await run("pactl", ["get-default-source"]);
      sourceName = parsePactlDefaultSource(`${gd.stdout || ""}\n${gd.stderr || ""}`);
    }
    const short = await run("pactl", ["list", "sources", "short"]);
    const sources = parsePactlSourcesShort(short.stdout || "");
    const monitor = sourceName ? looksLikeMonitorSource(sourceName, sourceName) : false;
    out.pulse = {
      ok: Boolean(sourceName) && !monitor,
      serverName: info.serverName,
      onPipeWire: info.onPipeWire,
      defaultSource: sourceName
        ? { name: sourceName, looksLikeMonitor: monitor }
        : null,
      sources: sources.slice(0, 12),
      error: !sourceName
        ? "no default source"
        : monitor
          ? "default source looks like a sink monitor"
          : undefined,
    };
    if (!out.defaultSource && out.pulse.defaultSource) {
      out.defaultSource = out.pulse.defaultSource;
    }
    if (monitor) {
      out.monitorRejected = true;
      out.errors.push("pulse default source is a monitor");
    }
  }

  if (explicit) {
    out.backend = "explicit";
    out.target = explicit;
    out.recordHint = {
      env: { PIPEWIRE_NODE: explicit, XCLAW_CAPTURE_TARGET: explicit },
      note: "explicit target — caller should set PIPEWIRE_NODE or -D",
    };
    out.ok = true;
  } else if (out.wireplumber.ok && out.defaultSource) {
    out.backend = "wireplumber";
    out.target =
      out.defaultSource.nodeName ||
      (out.defaultSource.id != null ? String(out.defaultSource.id) : null);
    out.recordHint = {
      env: out.target ? { PIPEWIRE_NODE: String(out.target) } : {},
      note: "use WirePlumber default source",
    };
    out.ok = true;
  } else if (out.pulse.ok && out.pulse.defaultSource) {
    out.backend = "pulse";
    out.target = out.pulse.defaultSource.name;
    out.recordHint = {
      pulseDevice: "@DEFAULT_SOURCE@",
      sourceName: out.pulse.defaultSource.name,
      arecordDevice: "pulse",
      note: "Pulse/pipewire-pulse default — parecord or arecord -D pulse",
    };
    out.ok = true;
  } else if (out.pipewire.ok && out.arecord.ok) {
    out.backend = "pipewire-alsa";
    out.recordHint = { note: "PipeWire present; arecord default may use pipewire PCM" };
    out.ok = !out.monitorRejected;
    if (out.monitorRejected) {
      out.errors.push("refusing pipewire-alsa while default is monitor");
    }
  } else if (out.arecord.ok) {
    out.backend = "alsa";
    const first = out.arecord.cards[0];
    out.target = first?.alsaDevice || null;
    out.recordHint = {
      arecordDevice: first?.alsaDevice,
      note: "pure ALSA — first capture card",
    };
    out.ok = true;
  } else {
    out.backend = null;
    out.ok = false;
    if (out.errors.length === 0) out.errors.push("no capture backend available");
  }

  return out;
}

export function captureReadyForWake(probe) {
  if (!probe) return false;
  if (probe.explicit && probe.ok) return true;
  if (probe.monitorRejected) return false;
  return Boolean(probe.ok);
}

export default {
  looksLikeMonitorSource,
  parseArecordList,
  parseWpctlStatus,
  parseWpctlInspect,
  parsePactlInfo,
  parsePactlDefaultSource,
  parsePactlSourcesShort,
  probeCapture,
  captureReadyForWake,
};
