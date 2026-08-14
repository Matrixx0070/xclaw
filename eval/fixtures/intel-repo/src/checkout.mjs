import { computeDiscountedPrice } from "./pricing.mjs";
export function checkoutTotal(items, tier) {
  return items.reduce((s, it) => s + computeDiscountedPrice(it.price, tier), 0);
}
