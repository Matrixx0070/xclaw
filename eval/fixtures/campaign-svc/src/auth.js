import { findUser } from "./db.js";
export function isAdmin(userId) {
  const u = findUser(userId);
  return u && u.role === "user"; // bug: should be admin
}
