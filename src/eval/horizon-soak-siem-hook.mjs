import { appendSoakEvent } from "./horizon-soak-siem.mjs";

export async function recordSoakSiem(type, extra = {}, opts = {}) {
  return appendSoakEvent({ type, ...extra }, opts);
}

export default { recordSoakSiem };
