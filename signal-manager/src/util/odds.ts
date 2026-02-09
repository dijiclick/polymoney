// Convert ask price (0-1) to decimal odds
// e.g. 0.25 → 4.00, 0.65 → 1.538
export function askToDecimal(askPrice: number): number {
  if (askPrice <= 0 || askPrice > 1) return 0;
  return Math.round((1 / askPrice) * 1000) / 1000;
}

// Convert American odds to decimal
// e.g. +150 → 2.50, -200 → 1.50
export function americanToDecimal(american: number): number {
  if (american > 0) {
    return Math.round((american / 100 + 1) * 1000) / 1000;
  }
  return Math.round((100 / Math.abs(american) + 1) * 1000) / 1000;
}

// Convert fractional odds to decimal
// e.g. 3/1 → 4.00, 1/2 → 1.50
export function fractionalToDecimal(numerator: number, denominator: number): number {
  if (denominator === 0) return 0;
  return Math.round((numerator / denominator + 1) * 1000) / 1000;
}

// Round to 3 decimal places (our precision standard)
export function roundOdds(value: number): number {
  return Math.round(value * 1000) / 1000;
}
