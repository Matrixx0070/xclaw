/**
 * WildClawBench category → XClaw capability modes (adoption map).
 * MIT reference: https://github.com/InternLM/WildClawBench
 */

/** @typedef {"ready"|"partial"|"missing"} ModeStatus */

/**
 * @type {Array<{
 *   id: string,
 *   wildclaw: string,
 *   status: ModeStatus,
 *   xclawTools: string[],
 *   notes: string
 * }>}
 */
export const WILDCLAW_MODES = [
  {
    id: "productivity_flow",
    wildclaw: "01_Productivity_Flow",
    status: "partial",
    xclawTools: [
      "xclaw_web_fetch",
      "xclaw_web_search",
      "xclaw_file_write",
      "xclaw_bash",
      "xclaw_document_convert",
      "xclaw_ocr",
    ],
    notes: "PDF/arXiv digest works with fetch+files; calendar/email need channel skills",
  },
  {
    id: "code_intelligence",
    wildclaw: "02_Code_Intelligence",
    status: "partial",
    xclawTools: ["xclaw_bash", "xclaw_file_read", "xclaw_file_write", "xclaw_file_edit"],
    notes: "Repo/code tasks OK; vision puzzles need multimodal model + image tools",
  },
  {
    id: "social_interaction",
    wildclaw: "03_Social_Interaction",
    status: "partial",
    xclawTools: ["channels:telegram", "channels:email", "channels:slack"],
    notes: "Channels exist; multi-party negotiation fixtures not in A4 pack yet",
  },
  {
    id: "search_retrieval",
    wildclaw: "04_Search_Retrieval",
    status: "partial",
    xclawTools: ["xclaw_web_search", "xclaw_web_fetch", "xclaw_file_read"],
    notes: "Local-vs-web conflict mode added in a4-W cases",
  },
  {
    id: "creative_synthesis",
    wildclaw: "05_Creative_Synthesis",
    status: "partial",
    xclawTools: [
      "xclaw_image_generate",
      "xclaw_ocr",
      "xclaw_document_convert",
      "video tools",
    ],
    notes: "Image/video skills present; full video pipeline depends on ffmpeg host",
  },
  {
    id: "safety_alignment",
    wildclaw: "06_Safety_Alignment",
    status: "partial",
    xclawTools: ["approvals", "sandbox", "ssrf", "spawn policy"],
    notes: "Security stack exists; dedicated safety eval cases still thin",
  },
];

export function modesSummary() {
  const c = { ready: 0, partial: 0, missing: 0 };
  for (const m of WILDCLAW_MODES) c[m.status]++;
  return c;
}

export default { WILDCLAW_MODES, modesSummary };
