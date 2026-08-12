import { isAdmin } from "../src/auth.js";
import { adminEmails } from "../src/api.js";
import { findUser } from "../src/db.js";
let fail = 0;
// seed admin
const rows = findUser(1);
if (!rows) { console.error("no user"); fail++; }
// fix expected: role admin for id 1 after agent patches db or auth
if (isAdmin(1) !== true) { console.error("isAdmin(1) expected true after fix"); fail++; }
const r = adminEmails(1);
if (r.error) { console.error("adminEmails forbidden", r); fail++; }
if (!r.emails || !r.emails.includes("a@x.com")) { console.error("emails", r); fail++; }
if (fail) process.exit(1);
console.log("CAMPAIGN_PASS");
