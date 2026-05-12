const {
  calculateStandardVat,
  calculateMarginVat,
  DEFAULT_VAT_RATE,
} = require('../../utils/inv-vat-calculator');

// ─── DEFAULT_VAT_RATE ────────────────────────────────────────────────

describe('DEFAULT_VAT_RATE', () => {
  it('should be 0.23 (Ireland 23%)', () => {
    expect(DEFAULT_VAT_RATE).toBe(0.23);
  });
});

// ─── calculateStandardVat ────────────────────────────────────────────

describe('calculateStandardVat', () => {
  it('should calculate VAT correctly for a typical selling price', () => {
    // VAT = 100 × 0.23 / 1.23 = 18.70 (rounded)
    expect(calculateStandardVat(100)).toBe(18.70);
  });

  it('should calculate VAT correctly for €999', () => {
    // VAT = 999 × 0.23 / 1.23 = 186.80 (rounded)
    const result = calculateStandardVat(999);
    expect(result).toBe(186.80);
  });

  it('should return 0 for a selling price of 0', () => {
    expect(calculateStandardVat(0)).toBe(0);
  });

  it('should accept a custom VAT rate', () => {
    // VAT = 100 × 0.10 / 1.10 = 9.09 (rounded)
    expect(calculateStandardVat(100, 0.10)).toBe(9.09);
  });

  it('should round to 2 decimal places', () => {
    // VAT = 33.33 × 0.23 / 1.23 = 6.2283... → 6.23
    expect(calculateStandardVat(33.33)).toBe(6.23);
  });

  it('should handle small amounts', () => {
    // VAT = 1 × 0.23 / 1.23 = 0.19 (rounded)
    expect(calculateStandardVat(1)).toBe(0.19);
  });

  it('should handle large amounts', () => {
    // VAT = 50000 × 0.23 / 1.23 = 9349.59 (rounded)
    expect(calculateStandardVat(50000)).toBe(9349.59);
  });

  it('should return 0 for negative selling price', () => {
    expect(calculateStandardVat(-100)).toBe(0);
  });

  it('should return 0 for NaN selling price', () => {
    expect(calculateStandardVat(NaN)).toBe(0);
  });

  it('should return 0 for non-number selling price', () => {
    expect(calculateStandardVat('100')).toBe(0);
    expect(calculateStandardVat(null)).toBe(0);
    expect(calculateStandardVat(undefined)).toBe(0);
  });

  it('should return 0 for negative VAT rate', () => {
    expect(calculateStandardVat(100, -0.1)).toBe(0);
  });

  it('should return 0 for NaN VAT rate', () => {
    expect(calculateStandardVat(100, NaN)).toBe(0);
  });

  it('should return 0 when VAT rate is 0', () => {
    expect(calculateStandardVat(100, 0)).toBe(0);
  });

  it('should use default VAT rate when not provided', () => {
    const withDefault = calculateStandardVat(100);
    const withExplicit = calculateStandardVat(100, 0.23);
    expect(withDefault).toBe(withExplicit);
  });
});

// ─── calculateMarginVat ──────────────────────────────────────────────

describe('calculateMarginVat', () => {
  it('should calculate Margin VAT correctly when selling price > cost price', () => {
    // margin = 500 - 300 = 200
    // VAT = 200 × 0.23 / 1.23 = 37.40 (rounded)
    expect(calculateMarginVat(500, 300)).toBe(37.40);
  });

  it('should return 0 when selling price equals cost price (no margin)', () => {
    expect(calculateMarginVat(300, 300)).toBe(0);
  });

  it('should return 0 when selling price < cost price (loss)', () => {
    expect(calculateMarginVat(200, 300)).toBe(0);
  });

  it('should accept a custom VAT rate', () => {
    // margin = 500 - 300 = 200
    // VAT = 200 × 0.10 / 1.10 = 18.18 (rounded)
    expect(calculateMarginVat(500, 300, 0.10)).toBe(18.18);
  });

  it('should round to 2 decimal places', () => {
    // margin = 333.33 - 100 = 233.33
    // VAT = 233.33 × 0.23 / 1.23 = 43.63 (rounded)
    expect(calculateMarginVat(333.33, 100)).toBe(43.63);
  });

  it('should handle small margins', () => {
    // margin = 101 - 100 = 1
    // VAT = 1 × 0.23 / 1.23 = 0.19 (rounded)
    expect(calculateMarginVat(101, 100)).toBe(0.19);
  });

  it('should handle large margins', () => {
    // margin = 50000 - 10000 = 40000
    // VAT = 40000 × 0.23 / 1.23 = 7479.67 (rounded)
    expect(calculateMarginVat(50000, 10000)).toBe(7479.67);
  });

  it('should return 0 when cost price is 0 and selling price is 0', () => {
    expect(calculateMarginVat(0, 0)).toBe(0);
  });

  it('should calculate correctly when cost price is 0', () => {
    // margin = 100 - 0 = 100
    // VAT = 100 × 0.23 / 1.23 = 18.70 (rounded)
    expect(calculateMarginVat(100, 0)).toBe(18.70);
  });

  it('should return 0 for negative selling price', () => {
    expect(calculateMarginVat(-100, 50)).toBe(0);
  });

  it('should return 0 for negative cost price', () => {
    expect(calculateMarginVat(100, -50)).toBe(0);
  });

  it('should return 0 for NaN selling price', () => {
    expect(calculateMarginVat(NaN, 100)).toBe(0);
  });

  it('should return 0 for NaN cost price', () => {
    expect(calculateMarginVat(100, NaN)).toBe(0);
  });

  it('should return 0 for non-number inputs', () => {
    expect(calculateMarginVat('500', 300)).toBe(0);
    expect(calculateMarginVat(500, '300')).toBe(0);
    expect(calculateMarginVat(null, 300)).toBe(0);
    expect(calculateMarginVat(500, null)).toBe(0);
  });

  it('should return 0 for negative VAT rate', () => {
    expect(calculateMarginVat(500, 300, -0.1)).toBe(0);
  });

  it('should use default VAT rate when not provided', () => {
    const withDefault = calculateMarginVat(500, 300);
    const withExplicit = calculateMarginVat(500, 300, 0.23);
    expect(withDefault).toBe(withExplicit);
  });
});
