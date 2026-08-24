/**
 * Model-markdown → Telegram HTML (parse_mode: "HTML").
 *
 * The agent writes **bold**, *italic*, `code`, ```fences``` and [links](url);
 * with no parse_mode Frank saw literal asterisks in replies (2026-08-24).
 * MarkdownV2 is rejected wholesale on any unescaped '.'/'-'/'(' so it is a
 * footgun for model text; HTML with entity-escaping first is robust.
 * Senders MUST fall back to plain text if Telegram rejects the HTML.
 */

function escapeHtml(s) {
  return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

/** Convert markdown-ish model output to Telegram-safe HTML. */
export function mdToTelegramHtml(text) {
  const src = String(text ?? "");
  const out = [];
  // Split out fenced blocks first so nothing inside them is styled.
  const parts = src.split(/```(\w*)\n?([\s\S]*?)```/g);
  // parts = [text, lang, code, text, lang, code, ..., text]
  for (let i = 0; i < parts.length; i++) {
    if (i % 3 === 0) {
      out.push(inlineMd(parts[i]));
    } else if (i % 3 === 2) {
      out.push(`<pre>${escapeHtml(parts[i].replace(/\n$/, ""))}</pre>`);
    }
    // i % 3 === 1 is the language tag — dropped.
  }
  return out.join("");
}

function inlineMd(text) {
  let s = escapeHtml(text);
  // inline code first — its contents must not be styled further
  const codes = [];
  s = s.replace(/`([^`\n]+)`/g, (_, c) => {
    codes.push(`<code>${c}</code>`);
    return `\u0000${codes.length - 1}\u0000`;
  });
  // links: [label](http…) — only http(s), everything else stays literal
  s = s.replace(/\[([^\]\n]+)\]\((https?:\/\/[^)\s]+)\)/g, (_, label, url) => {
    return `<a href="${url.replace(/"/g, "&quot;")}">${label}</a>`;
  });
  // bold then italic (order matters: ** before *)
  s = s.replace(/\*\*([^*\n]+)\*\*/g, "<b>$1</b>");
  s = s.replace(/(^|[\s(])\*([^*\n]+)\*(?=$|[\s).,!?:;])/g, "$1<i>$2</i>");
  // headings → bold line
  s = s.replace(/^#{1,6}\s+(.+)$/gm, "<b>$1</b>");
  return s.replace(/\u0000(\d+)\u0000/g, (_, n) => codes[Number(n)]);
}

/** Strip markdown markers for plain-text surfaces (voice captions, previews). */
export function mdToPlain(text) {
  return String(text ?? "")
    .replace(/```\w*\n?([\s\S]*?)```/g, "$1")
    .replace(/`([^`\n]+)`/g, "$1")
    .replace(/\*\*([^*\n]+)\*\*/g, "$1")
    .replace(/(^|[\s(])\*([^*\n]+)\*(?=$|[\s).,!?:;])/g, "$1$2")
    .replace(/^#{1,6}\s+/gm, "")
    .replace(/\[([^\]\n]+)\]\((https?:\/\/[^)\s]+)\)/g, "$1 ($2)");
}

export default { mdToTelegramHtml, mdToPlain };
