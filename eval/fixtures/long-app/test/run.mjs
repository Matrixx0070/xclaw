import { add, mul } from "../src/math.js";
import { greet } from "../src/greet.js";
let fail = 0;
if (add(2, 3) !== 5) { console.error("add fail", add(2,3)); fail++; }
if (mul(3, 4) !== 12) { console.error("mul fail"); fail++; }
if (greet("Ada") !== "Hello, Ada!") { console.error("greet fail", greet("Ada")); fail++; }
if (fail) process.exit(1);
console.log("ALL_PASS");
