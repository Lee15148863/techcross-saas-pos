const {
  applyItemDiscount,
  applyOrderDiscount,
  validateDiscountFloor,
  calculateDiscountedCart,
} = require('../../utils/inv-discount-calculator');

// ─── applyItemDiscount ───────────────────────────────────────────────

describe('applyItemDiscount', () => {
  describe('percentage discount', () => {
    it('should apply 10% discount correctly', () => {
      const result = applyItemDiscount(100, { type: 'percentage', value: 10 });
      expect(result.discountedPrice).toBe(90);
      expect(result.discountAmount).toBe(10);
    });

    it('should apply 50% discount correctly', () => {
      const result = applyItemDiscount(200, { type: 'percentage', value: 50 });
      expect(result.discountedPrice).toBe(100);
      expect(result.discountAmount).toBe(100);
    });

    it('should apply 100% discount (free)', () => {
      const result = applyItemDiscount(100, { type: 'percentage', value: 100 });
      expect(result.discountedPrice).toBe(0);
      expect(result.discountAmount).toBe(100);
    });

    it('should cap percentage at 100%', () => {
      const result = applyItemDiscount(100, { type: 'percentage', value: 150 });
      expect(result.discountedPrice).toBe(0);
      expect(result.discountAmount).toBe(100);
    });

    it('should handle 0% discount', () => {
      const result = applyItemDiscount(100, { type: 'percentage', value: 0 });
      expect(result.discountedPrice).toBe(100);
      expect(result.discountAmount).toBe(0);
    });

    it('should round to 2 decimal places', () => {
      // 33.33 * 15 / 100 = 4.9995 → 5.00
      const result = applyItemDiscount(33.33, { type: 'percentage', value: 15 });
      expect(result.discountAmount).toBe(5);
      expect(result.discountedPrice).toBe(28.33);
    });
  });

  describe('fixed discount', () => {
    it('should apply fixed discount correctly', () => {
      const result = applyItemDiscount(100, { type: 'fixed', value: 20 });
      expect(result.discountedPrice).toBe(80);
      expect(result.discountAmount).toBe(20);
    });

    it('should cap fixed discount at unit price', () => {
      const result = applyItemDiscount(50, { type: 'fixed', value: 80 });
      expect(result.discountedPrice).toBe(0);
      expect(result.discountAmount).toBe(50);
    });

    it('should handle 0 fixed discount', () => {
      const result = applyItemDiscount(100, { type: 'fixed', value: 0 });
      expect(result.discountedPrice).toBe(100);
      expect(result.discountAmount).toBe(0);
    });

    it('should handle exact price fixed discount', () => {
      const result = applyItemDiscount(100, { type: 'fixed', value: 100 });
      expect(result.discountedPrice).toBe(0);
      expect(result.discountAmount).toBe(100);
    });
  });

  describe('edge cases', () => {
    it('should return original price when no discount provided', () => {
      const result = applyItemDiscount(100, null);
      expect(result.discountedPrice).toBe(100);
      expect(result.discountAmount).toBe(0);
    });

    it('should return original price for undefined discount', () => {
      const result = applyItemDiscount(100, undefined);
      expect(result.discountedPrice).toBe(100);
      expect(result.discountAmount).toBe(0);
    });

    it('should return 0 for negative unit price', () => {
      const result = applyItemDiscount(-50, { type: 'percentage', value: 10 });
      expect(result.discountedPrice).toBe(0);
      expect(result.discountAmount).toBe(0);
    });

    it('should return 0 for NaN unit price', () => {
      const result = applyItemDiscount(NaN, { type: 'fixed', value: 10 });
      expect(result.discountedPrice).toBe(0);
      expect(result.discountAmount).toBe(0);
    });

    it('should return original price for invalid discount type', () => {
      const result = applyItemDiscount(100, { type: 'bogus', value: 10 });
      expect(result.discountedPrice).toBe(100);
      expect(result.discountAmount).toBe(0);
    });

    it('should return original price for negative discount value', () => {
      const result = applyItemDiscount(100, { type: 'percentage', value: -10 });
      expect(result.discountedPrice).toBe(100);
      expect(result.discountAmount).toBe(0);
    });

    it('should return original price for NaN discount value', () => {
      const result = applyItemDiscount(100, { type: 'fixed', value: NaN });
      expect(result.discountedPrice).toBe(100);
      expect(result.discountAmount).toBe(0);
    });

    it('should handle unit price of 0', () => {
      const result = applyItemDiscount(0, { type: 'percentage', value: 10 });
      expect(result.discountedPrice).toBe(0);
      expect(result.discountAmount).toBe(0);
    });
  });
});

// ─── applyOrderDiscount ──────────────────────────────────────────────

describe('applyOrderDiscount', () => {
  describe('percentage discount', () => {
    it('should apply 10% order discount', () => {
      const result = applyOrderDiscount(500, { type: 'percentage', value: 10 });
      expect(result.discountedTotal).toBe(450);
      expect(result.discountAmount).toBe(50);
    });

    it('should apply 100% order discount', () => {
      const result = applyOrderDiscount(500, { type: 'percentage', value: 100 });
      expect(result.discountedTotal).toBe(0);
      expect(result.discountAmount).toBe(500);
    });

    it('should cap at 100%', () => {
      const result = applyOrderDiscount(500, { type: 'percentage', value: 200 });
      expect(result.discountedTotal).toBe(0);
      expect(result.discountAmount).toBe(500);
    });
  });

  describe('fixed discount', () => {
    it('should apply fixed order discount', () => {
      const result = applyOrderDiscount(500, { type: 'fixed', value: 50 });
      expect(result.discountedTotal).toBe(450);
      expect(result.discountAmount).toBe(50);
    });

    it('should cap fixed discount at subtotal', () => {
      const result = applyOrderDiscount(100, { type: 'fixed', value: 200 });
      expect(result.discountedTotal).toBe(0);
      expect(result.discountAmount).toBe(100);
    });
  });

  describe('edge cases', () => {
    it('should return original subtotal when no discount', () => {
      const result = applyOrderDiscount(500, null);
      expect(result.discountedTotal).toBe(500);
      expect(result.discountAmount).toBe(0);
    });

    it('should return 0 for negative subtotal', () => {
      const result = applyOrderDiscount(-100, { type: 'percentage', value: 10 });
      expect(result.discountedTotal).toBe(0);
      expect(result.discountAmount).toBe(0);
    });

    it('should return 0 for NaN subtotal', () => {
      const result = applyOrderDiscount(NaN, { type: 'fixed', value: 10 });
      expect(result.discountedTotal).toBe(0);
      expect(result.discountAmount).toBe(0);
    });

    it('should return original for invalid discount type', () => {
      const result = applyOrderDiscount(500, { type: 'invalid', value: 10 });
      expect(result.discountedTotal).toBe(500);
      expect(result.discountAmount).toBe(0);
    });
  });
});

// ─── validateDiscountFloor ───────────────────────────────────────────

describe('validateDiscountFloor', () => {
  it('should return valid when discounted price is above floor', () => {
    // costPrice = 100, vatRate = 0.23
    // floor = 100 / 1.23 = 81.30
    const result = validateDiscountFloor(90, 100, 0.23);
    expect(result.valid).toBe(true);
    expect(result.error).toBeUndefined();
  });

  it('should return valid when discounted price equals floor', () => {
    // floor = 100 / 1.23 = 81.30
    const result = validateDiscountFloor(81.30, 100, 0.23);
    expect(result.valid).toBe(true);
  });

  it('should return invalid when discounted price is below floor', () => {
    // floor = 100 / 1.23 = 81.30
    const result = validateDiscountFloor(70, 100, 0.23);
    expect(result.valid).toBe(false);
    expect(result.error).toBeDefined();
  });

  it('should use default VAT rate when not provided', () => {
    // floor = 100 / 1.23 = 81.30
    const result = validateDiscountFloor(90, 100);
    expect(result.valid).toBe(true);
  });

  it('should handle zero cost price', () => {
    // floor = 0 / 1.23 = 0
    const result = validateDiscountFloor(10, 0, 0.23);
    expect(result.valid).toBe(true);
  });

  it('should return invalid for NaN discounted price', () => {
    const result = validateDiscountFloor(NaN, 100, 0.23);
    expect(result.valid).toBe(false);
  });

  it('should return invalid for negative cost price', () => {
    const result = validateDiscountFloor(50, -100, 0.23);
    expect(result.valid).toBe(false);
  });

  it('should return invalid for NaN VAT rate', () => {
    const result = validateDiscountFloor(50, 100, NaN);
    expect(result.valid).toBe(false);
  });

  it('should return invalid for negative VAT rate', () => {
    const result = validateDiscountFloor(50, 100, -0.1);
    expect(result.valid).toBe(false);
  });

  it('should handle custom VAT rate', () => {
    // floor = 100 / 1.10 = 90.91
    const result = validateDiscountFloor(91, 100, 0.10);
    expect(result.valid).toBe(true);

    const result2 = validateDiscountFloor(89, 100, 0.10);
    expect(result2.valid).toBe(false);
  });
});

// ─── calculateDiscountedCart ─────────────────────────────────────────

describe('calculateDiscountedCart', () => {
  describe('basic cart without discounts', () => {
    it('should calculate cart with no discounts', () => {
      const items = [
        { unitPrice: 100, costPrice: 60, quantity: 2, isSecondHand: false },
      ];
      const result = calculateDiscountedCart(items, null, 0.23);

      expect(result.items).toHaveLength(1);
      expect(result.items[0].discountedPrice).toBe(100);
      expect(result.items[0].subtotal).toBe(200);
      expect(result.subtotalBeforeOrderDiscount).toBe(200);
      expect(result.orderDiscountAmount).toBe(0);
      expect(result.totalAmount).toBe(200);
      expect(result.standardVatTotal).toBeGreaterThan(0);
      expect(result.marginVatTotal).toBe(0);
    });

    it('should return empty result for empty items', () => {
      const result = calculateDiscountedCart([], null, 0.23);
      expect(result.items).toHaveLength(0);
      expect(result.totalAmount).toBe(0);
    });

    it('should return empty result for null items', () => {
      const result = calculateDiscountedCart(null, null, 0.23);
      expect(result.items).toHaveLength(0);
      expect(result.totalAmount).toBe(0);
    });
  });

  describe('item-level discounts only', () => {
    it('should apply percentage item discount', () => {
      const items = [
        { unitPrice: 100, costPrice: 60, quantity: 1, isSecondHand: false, discount: { type: 'percentage', value: 10 } },
      ];
      const result = calculateDiscountedCart(items, null, 0.23);

      expect(result.items[0].discountedPrice).toBe(90);
      expect(result.items[0].itemDiscountAmount).toBe(10);
      expect(result.items[0].subtotal).toBe(90);
      expect(result.totalAmount).toBe(90);
    });

    it('should apply fixed item discount', () => {
      const items = [
        { unitPrice: 100, costPrice: 60, quantity: 1, isSecondHand: false, discount: { type: 'fixed', value: 15 } },
      ];
      const result = calculateDiscountedCart(items, null, 0.23);

      expect(result.items[0].discountedPrice).toBe(85);
      expect(result.items[0].subtotal).toBe(85);
      expect(result.totalAmount).toBe(85);
    });

    it('should handle multiple items with different discounts', () => {
      const items = [
        { unitPrice: 100, costPrice: 60, quantity: 1, isSecondHand: false, discount: { type: 'percentage', value: 10 } },
        { unitPrice: 200, costPrice: 120, quantity: 2, isSecondHand: false, discount: { type: 'fixed', value: 20 } },
      ];
      const result = calculateDiscountedCart(items, null, 0.23);

      expect(result.items[0].discountedPrice).toBe(90);
      expect(result.items[0].subtotal).toBe(90);
      expect(result.items[1].discountedPrice).toBe(180);
      expect(result.items[1].subtotal).toBe(360);
      expect(result.totalAmount).toBe(450);
    });
  });

  describe('order-level discount only', () => {
    it('should apply percentage order discount', () => {
      const items = [
        { unitPrice: 100, costPrice: 60, quantity: 1, isSecondHand: false },
        { unitPrice: 200, costPrice: 120, quantity: 1, isSecondHand: false },
      ];
      const result = calculateDiscountedCart(items, { type: 'percentage', value: 10 }, 0.23);

      expect(result.subtotalBeforeOrderDiscount).toBe(300);
      expect(result.orderDiscountAmount).toBe(30);
      expect(result.totalAmount).toBe(270);
    });

    it('should apply fixed order discount', () => {
      const items = [
        { unitPrice: 100, costPrice: 60, quantity: 1, isSecondHand: false },
      ];
      const result = calculateDiscountedCart(items, { type: 'fixed', value: 25 }, 0.23);

      expect(result.subtotalBeforeOrderDiscount).toBe(100);
      expect(result.orderDiscountAmount).toBe(25);
      expect(result.totalAmount).toBe(75);
    });
  });

  describe('discount priority: item first, then order', () => {
    it('should apply item discount before order discount', () => {
      const items = [
        { unitPrice: 100, costPrice: 60, quantity: 1, isSecondHand: false, discount: { type: 'percentage', value: 10 } },
      ];
      // Item discount: 100 → 90
      // Order discount: 90 * 10% = 9 → 81
      const result = calculateDiscountedCart(items, { type: 'percentage', value: 10 }, 0.23);

      expect(result.subtotalBeforeOrderDiscount).toBe(90);
      expect(result.orderDiscountAmount).toBe(9);
      expect(result.totalAmount).toBe(81);
    });

    it('should apply item fixed + order percentage', () => {
      const items = [
        { unitPrice: 200, costPrice: 100, quantity: 1, isSecondHand: false, discount: { type: 'fixed', value: 50 } },
      ];
      // Item discount: 200 - 50 = 150
      // Order discount: 150 * 20% = 30 → 120
      const result = calculateDiscountedCart(items, { type: 'percentage', value: 20 }, 0.23);

      expect(result.subtotalBeforeOrderDiscount).toBe(150);
      expect(result.orderDiscountAmount).toBe(30);
      expect(result.totalAmount).toBe(120);
    });
  });

  describe('VAT recalculation after discount', () => {
    it('should recalculate standard VAT after item discount', () => {
      const items = [
        { unitPrice: 100, costPrice: 60, quantity: 1, isSecondHand: false, discount: { type: 'percentage', value: 10 } },
      ];
      const result = calculateDiscountedCart(items, null, 0.23);

      // Discounted price = 90
      // Standard VAT = 90 * 0.23 / 1.23 = 16.83
      expect(result.items[0].discountedPrice).toBe(90);
      expect(result.standardVatTotal).toBe(16.83);
      expect(result.marginVatTotal).toBe(0);
    });

    it('should recalculate margin VAT after discount for second-hand items', () => {
      const items = [
        { unitPrice: 500, costPrice: 300, quantity: 1, isSecondHand: true, discount: { type: 'fixed', value: 50 } },
      ];
      const result = calculateDiscountedCart(items, null, 0.23);

      // Discounted price = 450
      // Margin VAT = (450 - 300) * 0.23 / 1.23 = 28.05
      expect(result.items[0].discountedPrice).toBe(450);
      expect(result.items[0].marginVat).toBe(28.05);
      expect(result.standardVatTotal).toBe(0);
      expect(result.marginVatTotal).toBe(28.05);
    });

    it('should set margin VAT to 0 when discount makes price equal to cost', () => {
      const items = [
        { unitPrice: 500, costPrice: 500, quantity: 1, isSecondHand: true },
      ];
      const result = calculateDiscountedCart(items, null, 0.23);

      expect(result.items[0].marginVat).toBe(0);
      expect(result.marginVatTotal).toBe(0);
    });

    it('should recalculate VAT after order discount', () => {
      const items = [
        { unitPrice: 100, costPrice: 60, quantity: 1, isSecondHand: false },
      ];
      const result = calculateDiscountedCart(items, { type: 'fixed', value: 10 }, 0.23);

      // After order discount: 100 - 10 = 90
      // Standard VAT = 90 * 0.23 / 1.23 = 16.83
      expect(result.totalAmount).toBe(90);
      expect(result.standardVatTotal).toBe(16.83);
    });
  });

  describe('mixed standard and second-hand items', () => {
    it('should calculate VAT separately for standard and second-hand items', () => {
      const items = [
        { unitPrice: 100, costPrice: 60, quantity: 1, isSecondHand: false },
        { unitPrice: 500, costPrice: 300, quantity: 1, isSecondHand: true },
      ];
      const result = calculateDiscountedCart(items, null, 0.23);

      // Standard item: VAT = 100 * 0.23 / 1.23 = 18.70
      // Second-hand item: Margin VAT = (500 - 300) * 0.23 / 1.23 = 37.40
      expect(result.standardVatTotal).toBe(18.70);
      expect(result.marginVatTotal).toBe(37.40);
      expect(result.totalAmount).toBe(600);
    });
  });

  describe('quantity handling', () => {
    it('should multiply discount by quantity', () => {
      const items = [
        { unitPrice: 50, costPrice: 30, quantity: 3, isSecondHand: false, discount: { type: 'fixed', value: 5 } },
      ];
      const result = calculateDiscountedCart(items, null, 0.23);

      // Discounted price per unit = 45
      // Subtotal = 45 * 3 = 135
      expect(result.items[0].discountedPrice).toBe(45);
      expect(result.items[0].subtotal).toBe(135);
      expect(result.totalAmount).toBe(135);
    });
  });

  describe('rounding', () => {
    it('should round all monetary values to 2 decimal places', () => {
      const items = [
        { unitPrice: 33.33, costPrice: 20, quantity: 3, isSecondHand: false, discount: { type: 'percentage', value: 7 } },
      ];
      const result = calculateDiscountedCart(items, null, 0.23);

      // Check all values are rounded to 2 decimal places
      expect(Number(result.items[0].discountedPrice.toFixed(2))).toBe(result.items[0].discountedPrice);
      expect(Number(result.items[0].subtotal.toFixed(2))).toBe(result.items[0].subtotal);
      expect(Number(result.totalAmount.toFixed(2))).toBe(result.totalAmount);
      expect(Number(result.standardVatTotal.toFixed(2))).toBe(result.standardVatTotal);
    });
  });
});
