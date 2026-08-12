const rows = [{ id: 1, email: "a@x.com", role: "user" }];
export function findUser(id) {
  return rows.find((r) => r.id === id) || null;
}
export function listEmails() {
  return rows.map((r) => r.email);
}
