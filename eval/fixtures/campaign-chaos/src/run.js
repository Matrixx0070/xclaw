import { calc } from "./calc.js";
const r = calc(8, 2);
if (r !== 4) {
  console.error("got", r);
  process.exit(1);
}
console.log("RESULT=" + r);
