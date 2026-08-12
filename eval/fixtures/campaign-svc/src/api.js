import { isAdmin } from "./auth.js";
import { listEmails } from "./db.js";
export function adminEmails(userId) {
  if (!isAdmin(userId)) return { error: "forbidden" };
  return { emails: listEmails() };
}
