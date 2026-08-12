import { sum } from "./sum.js";
const r = sum(2, 3);
if (r !== 5) {
  console.error("expected 5 got", r);
  process.exit(1);
}
console.log("OK");
