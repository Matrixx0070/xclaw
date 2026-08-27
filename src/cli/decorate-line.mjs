/**
 * Terminal decorative prefix (spec §16.4).
 *
 * Glyph-prefix a CLI line only when stdout is a UTF-8 TTY that renders
 * emoji; strip pictographs everywhere else. Do not prefix operator-facing
 * CLI errors with glyphs when stdout is not a UTF-8 TTY. Voice replies
 * already strip glyphs in src/voice/speakable.mjs — that file is
 * unchanged.
 */

const PICTO = /[\p{Extended_Pictographic}\p{Regional_Indicator}\u20e3]/u;

export function emojiTtyOk(env = process.env, { isTty = process.stdout.isTTY, platform = process.platform } = {}) {
  if (!isTty) return false;
  if ((env.TERM || "").toLowerCase() === "dumb") return false;
  const loc = [env.LC_ALL, env.LC_CTYPE, env.LANG].find((v) => v && String(v).trim());
  if (loc && !/utf-?8/i.test(loc)) return false;
  const prog = `${env.TERM_PROGRAM || ""} ${env.TERM || ""}`.toLowerCase();
  if (/iterm|apple_terminal|ghostty|wezterm|vscode/.test(prog) || env.WT_SESSION) return true;
  return platform === "darwin";
}

export function decorateLine(glyph, text, opts) {
  return emojiTtyOk(process.env, opts) ? `${glyph} ${text}` : text;
}

export function stripLineGlyphs(text, opts) {
  if (emojiTtyOk(process.env, opts)) return text;
  return [...text].filter((g) => !PICTO.test(g)).join("").replace(/\s{2,}/g, " ").trim();
}
