import { getConfig } from "./config.mjs";
import { handle } from "./handler.mjs";
const cfg = getConfig();
const out = handle({ path: "/health", cfg });
if (out.status !== 200 || out.body?.ok !== true) {
  console.error(out);
  process.exit(1);
}
console.log("API_OK");
