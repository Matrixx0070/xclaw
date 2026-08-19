#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { writeSourceIfChanged } from "./lib/atomic-source-write.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

const readme = path.join(root, "README.md");
let t = fs.readFileSync(readme, "utf8");
const old =
  "## License\n\nMIT — see [THIRD_PARTY.md](./THIRD_PARTY.md) for bundled components.\n";
const neu = "## License\n\nXClaw is licensed under the MIT License. See [LICENSE](./LICENSE).\n";
if (t.includes(old)) t = t.replace(old, neu);
t = t.replace(/see \[THIRD_PARTY\.md\]\(\.\/THIRD_PARTY\.md\) for bundled components\./g, "See [LICENSE](./LICENSE).");
writeSourceIfChanged(readme, t);

const pkgPath = path.join(root, "package.json");
const pkg = JSON.parse(fs.readFileSync(pkgPath, "utf8"));
if (Array.isArray(pkg.files)) {
  pkg.files = pkg.files.filter((f) => f !== "THIRD_PARTY.md");
  if (!pkg.files.includes("LICENSE")) pkg.files.push("LICENSE");
  writeSourceIfChanged(pkgPath, JSON.stringify(pkg, null, 2) + "\n");
}

const tp = path.join(root, "THIRD_PARTY.md");
if (fs.existsSync(tp)) fs.unlinkSync(tp);

console.log(JSON.stringify({ ok: true, dropped: "THIRD_PARTY.md" }));
