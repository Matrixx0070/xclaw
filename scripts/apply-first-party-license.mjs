#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const fp = path.join(root, "README.md");
let t = fs.readFileSync(fp, "utf8");
const old =
  "## License\n\nMIT — see [THIRD_PARTY.md](./THIRD_PARTY.md) for bundled components.\n";
const neu =
  "## License\n\nXClaw is licensed under the MIT License. See [LICENSE](./LICENSE).\n\nThird-party notices for adapted components are in [THIRD_PARTY.md](./THIRD_PARTY.md).\n";
if (t.includes(old)) {
  fs.writeFileSync(fp, t.replace(old, neu));
  console.log(JSON.stringify({ ok: true, readme: true }));
} else if (t.includes("[LICENSE](./LICENSE)")) {
  console.log(JSON.stringify({ ok: true, readme: "already" }));
} else {
  console.log(JSON.stringify({ ok: false, reason: "readme_block_missing" }));
  process.exitCode = 1;
}
