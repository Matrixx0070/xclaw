/**
 * toSpeakableText — turn an agent reply (markdown, lists, links, symbols)
 * into text a TTS engine can speak naturally.
 *
 * Without this, voice replies read markup aloud: bullets, asterisks,
 * parentheses, raw URLs and emoji all end up vocalized or produce garbage
 * prosody (Frank, 2026-08-24: "in voice agent it also speak . , ( etc").
 *
 * Sentence punctuation (. , ! ?) is KEPT — engines use it for prosody.
 * Everything that is layout or markup gets converted or dropped.
 */

const EMOJI_RE =
  /[\u{1F300}-\u{1FAFF}\u{1F000}-\u{1F02F}\u{2600}-\u{27BF}\u{FE0F}\u{200D}\u{2190}-\u{21FF}\u{2B00}-\u{2BFF}]/gu;

export function toSpeakableText(text, { maxChars = 0 } = {}) {
  let s = String(text ?? "");

  // fenced code blocks: never read code aloud
  s = s.replace(/```[\s\S]*?```/g, " Code omitted. ");
  // inline code: keep the content, drop the backticks
  s = s.replace(/`([^`\n]+)`/g, "$1");
  // markdown links: speak the label only
  s = s.replace(/\[([^\]\n]+)\]\((?:https?:\/\/)[^)\s]+\)/g, "$1");
  // bare URLs: speak the hostname only
  s = s.replace(/(?:https?:\/\/|www\.)([^\s/]+)[^\s]*/gi, (m, host) =>
    host.replace(/^www\./i, "")
  );
  // bold / italic markers
  s = s.replace(/\*\*([^*\n]+)\*\*/g, "$1").replace(/__([^_\n]+)__/g, "$1");
  s = s.replace(/(^|[\s(])[*_]([^*_\n]+)[*_](?=$|[\s).,!?:;])/g, "$1$2");
  // headings: content + sentence break
  s = s.replace(/^#{1,6}\s+(.+)$/gm, "$1.");
  // list items → sentences ("- x" / "• x" / "1. x" / "* x")
  s = s.replace(/^\s*(?:[-*•‣▪]|\d+[.)])\s+/gm, "");
  // tables: drop pipes and separator rows
  s = s.replace(/^\s*\|?[-:| ]+\|?\s*$/gm, "");
  s = s.replace(/\|/g, ", ");
  // parentheticals: keep content, drop the brackets (TTS pauses on commas)
  s = s.replace(/[()[\]{}<>]/g, ", ");
  // symbols that engines spell out or mangle
  s = s.replace(/[*_#~^`"“”'’«»=+\\]/g, " ");
  s = s.replace(/[—–]/g, ", ");
  s = s.replace(/\//g, " ");
  s = s.replace(EMOJI_RE, " ");
  // ellipses and repeated punctuation → single mark
  s = s.replace(/…/g, ".").replace(/\.{2,}/g, ".").replace(/([,;:!?]){2,}/g, "$1");
  // stray punctuation runs left by the substitutions (", ." / ", ," / " , ")
  s = s.replace(/\s*,\s*(?=[,.;:!?])/g, "");
  s = s.replace(/(^|\n)\s*[,.;:]+\s*/g, "$1");
  // line breaks → sentence-ish pauses; collapse whitespace
  s = s.replace(/\n{2,}/g, ". ").replace(/\n/g, ", ");
  s = s.replace(/\s{2,}/g, " ").trim();
  // re-collapse punctuation runs the line-break pass may have created
  // ("., " → ". ", ",," → ",") — keep the first mark, drop the rest
  s = s.replace(/([,.;:!?])(\s*[,.;:])+/g, "$1 ").replace(/\s{2,}/g, " ");
  s = s.replace(/\s+([,.;:!?])/g, "$1");

  if (maxChars > 0 && s.length > maxChars) {
    const cut = s.slice(0, maxChars);
    const lastStop = Math.max(cut.lastIndexOf(". "), cut.lastIndexOf("! "), cut.lastIndexOf("? "));
    s = lastStop > maxChars * 0.5 ? cut.slice(0, lastStop + 1) : cut;
  }
  return s;
}

export default { toSpeakableText };
