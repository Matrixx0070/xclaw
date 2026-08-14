export function computeDiscountedPrice(base, tier) {
  const rates = { gold: 0.8, silver: 0.9 };
  return base * (rates[tier] ?? 1);
}
