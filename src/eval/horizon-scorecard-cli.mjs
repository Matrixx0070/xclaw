#!/usr/bin/env node
import { buildAutonomyScorecard } from "./horizon-scorecard.mjs";

export async function main(argv = process.argv.slice(2)) {
  const card = await buildAutonomyScorecard({});
  console.log(JSON.stringify(card, null, 2));
  process.exitCode = card.ok ? 0 : 1;
  return card;
}

if (
  import.meta.url === `file://${process.argv[1]}` ||
  process.argv[1]?.endsWith("horizon-scorecard-cli.mjs")
) {
  main().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}

export default { main };
