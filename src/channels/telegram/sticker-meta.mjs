/**
 * Rich sticker metadata extraction + optional set lookup.
 */
import { formatStickerEmojiLabel } from "./emoji.mjs";

/**
 * Normalize Telegram Sticker object → XClaw metadata.
 * @param {object} s
 */
export function normalizeStickerMeta(s = {}) {
  if (!s || typeof s !== "object") return null;
  return {
    type: "sticker",
    emoji: s.emoji || null,
    setName: s.set_name || null,
    fileId: s.file_id || null,
    fileUniqueId: s.file_unique_id || null,
    fileSize: s.file_size ?? null,
    width: s.width ?? null,
    height: s.height ?? null,
    isAnimated: Boolean(s.is_animated),
    isVideo: Boolean(s.is_video),
    isPremium: Boolean(s.premium_animation),
    customEmojiId: s.custom_emoji_id || null,
    thumbnail: s.thumbnail
      ? {
          fileId: s.thumbnail.file_id,
          fileUniqueId: s.thumbnail.file_unique_id,
          width: s.thumbnail.width,
          height: s.thumbnail.height,
          fileSize: s.thumbnail.file_size,
        }
      : null,
    label: formatStickerEmojiLabel(s),
  };
}

/**
 * Agent-facing lines from sticker meta.
 * @param {object} meta normalizeStickerMeta result
 */
export function stickerMetaToTextParts(meta) {
  if (!meta) return [];
  const bits = [
    `[Sticker${meta.emoji ? ` ${meta.emoji}` : ""}]`,
    meta.setName ? `set=${meta.setName}` : null,
    meta.isAnimated ? "animated" : null,
    meta.isVideo ? "video" : null,
    meta.isPremium ? "premium" : null,
    meta.customEmojiId ? `custom_emoji=${meta.customEmojiId}` : null,
    meta.width && meta.height ? `${meta.width}x${meta.height}` : null,
    meta.fileUniqueId ? `uid=${meta.fileUniqueId}` : null,
  ];
  return [bits.filter(Boolean).join(" · ")];
}

/**
 * Optional: fetch sticker set metadata (names, title).
 * @param {(method: string, body?: object) => Promise<any>} api
 * @param {string} setName
 */
export async function fetchStickerSetMeta(api, setName) {
  if (!setName || typeof api !== "function") return null;
  try {
    const set = await api("getStickerSet", { name: setName });
    return {
      name: set.name,
      title: set.title,
      stickerType: set.sticker_type || null,
      isAnimated: Boolean(set.is_animated),
      isVideo: Boolean(set.is_video),
      count: Array.isArray(set.stickers) ? set.stickers.length : 0,
    };
  } catch {
    return null;
  }
}

/**
 * Enrich sticker meta with set title when possible (best-effort).
 */
export async function enrichStickerMeta(api, sticker) {
  const meta = normalizeStickerMeta(sticker);
  if (!meta?.setName) return meta;
  const set = await fetchStickerSetMeta(api, meta.setName);
  if (set) {
    meta.setTitle = set.title;
    meta.setCount = set.count;
    meta.stickerType = set.stickerType;
  }
  return meta;
}

export default {
  normalizeStickerMeta,
  stickerMetaToTextParts,
  fetchStickerSetMeta,
  enrichStickerMeta,
};
