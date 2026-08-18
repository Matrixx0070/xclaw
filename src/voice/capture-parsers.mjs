/**
 * Pure parsers for capture device probe (no process spawn).
 */

/** True when name/description looks like a sink monitor, not a mic. */
export function looksLikeMonitorSource(name = "", description = "") {
  const s = `${name} ${description}`.toLowerCase();
  if (!s.trim()) return false;
  if (/\.monitor\b/.test(s)) return true;
  if (/\bmonitor of\b/.test(s)) return true;
  if (/\bmonitor\b/.test(s) && /\b(sink|output|speaker|playback)\b/.test(s)) {
    return true;
  }
  if (/^alsa_output\./.test(String(name).trim())) return true;
  return false;
}

/** Parse `arecord -l` for card indices and names. */
export function parseArecordList(text = "") {
  const cards = [];
  const re =
    /card\s+(\d+):\s*([^\[]+)\[([^\]]*)\]\s*,\s*device\s+(\d+):\s*([^\[]*)\[([^\]]*)\]/gi;
  let m;
  while ((m = re.exec(text)) !== null) {
    cards.push({
      card: Number(m[1]),
      id: m[2].trim(),
      name: m[3].trim(),
      device: Number(m[4]),
      deviceId: m[5].trim(),
      deviceName: m[6].trim(),
      alsaDevice: `plughw:${m[1]},${m[4]}`,
    });
  }
  if (cards.length === 0) {
    const simple = /card\s+(\d+):\s*(\S+)\s*\[([^\]]+)\]/gi;
    while ((m = simple.exec(text)) !== null) {
      cards.push({
        card: Number(m[1]),
        id: m[2].trim(),
        name: m[3].trim(),
        device: 0,
        deviceId: "",
        deviceName: "",
        alsaDevice: `plughw:${m[1]},0`,
      });
    }
  }
  return cards;
}

/** Parse `wpctl status` Sources section for default (*) and entries. */
export function parseWpctlStatus(text = "") {
  const sources = [];
  let inSources = false;
  for (const raw of String(text).split(/\r?\n/)) {
    const line = raw
      .replace(/[\u2500-\u257F]+/g, " ")
      .replace(/\s+/g, " ")
      .trim();
    if (/^Sources?:?$/i.test(line) || /^Sources?\s*:/i.test(line)) {
      inSources = true;
      continue;
    }
    if (inSources) {
      if (
        /^(Sinks?|Filters?|Streams?|Video|Settings|Devices?|Playback|Capture)\b/i.test(
          line
        )
      ) {
        inSources = false;
        continue;
      }
    }
    if (!inSources) continue;
    const m = line.match(/^(\*)?\s*(\d+)\.\s+(.+?)(?:\s+\[vol:.*\])?\s*$/i);
    if (m) {
      const name = m[3].trim();
      sources.push({
        id: Number(m[2]),
        name,
        isDefault: Boolean(m[1]),
        looksLikeMonitor: looksLikeMonitorSource(name, name),
      });
    }
  }
  const defaultSource = sources.find((s) => s.isDefault) || null;
  return { sources, defaultSource };
}

/** Inspect a single wpctl object for node.name / media.class / mute. */
export function parseWpctlInspect(text = "") {
  const get = (key) => {
    const re = new RegExp(`(?:^|\\*)\\s*${key}\\s*=\\s*"?([^"\\n]+)"?`, "im");
    const m = text.match(re);
    return m ? m[1].trim() : null;
  };
  const nodeName = get("node\\.name") || get("node.name");
  const mediaClass = get("media\\.class") || get("media.class");
  const description =
    get("node\\.description") ||
    get("node.description") ||
    get("node\\.nick") ||
    get("node.nick") ||
    "";
  const mute =
    /mute:\s*true/i.test(text) ||
    /\*\s*mute\s*=\s*"?true"?/i.test(text) ||
    /\bmuted\b/i.test(text);
  return {
    nodeName,
    mediaClass,
    description,
    mute,
    looksLikeMonitor: looksLikeMonitorSource(nodeName || "", description),
  };
}

/** Parse `pactl info` for server name and default source/sink. */
export function parsePactlInfo(text = "") {
  const serverName =
    text.match(/^\s*Server Name:\s*(.+)$/im)?.[1]?.trim() || null;
  const defaultSource =
    text.match(/^\s*Default Source:\s*(.+)$/im)?.[1]?.trim() || null;
  const defaultSink =
    text.match(/^\s*Default Sink:\s*(.+)$/im)?.[1]?.trim() || null;
  const onPipeWire = /PipeWire/i.test(serverName || "");
  return { serverName, defaultSource, defaultSink, onPipeWire };
}

/** Parse `pactl get-default-source` (single line name or error). */
export function parsePactlDefaultSource(text = "") {
  const line = String(text)
    .split(/\r?\n/)
    .map((l) => l.trim())
    .find((l) => l && !/^failure/i.test(l));
  if (!line || /no such|does not exist|failure/i.test(line)) return null;
  return line;
}

/** Parse `pactl list sources short` */
export function parsePactlSourcesShort(text = "") {
  const sources = [];
  for (const raw of String(text).split(/\r?\n/)) {
    const line = raw.trim();
    if (!line) continue;
    const parts = line.split(/\t+/);
    if (parts.length < 2) continue;
    const id = Number(parts[0]);
    if (!Number.isFinite(id)) continue;
    const name = parts[1].trim();
    sources.push({
      id,
      name,
      module: parts[2] || null,
      format: parts[3] || null,
      state: parts[4] || null,
      looksLikeMonitor: looksLikeMonitorSource(name, name),
    });
  }
  return sources;
}
