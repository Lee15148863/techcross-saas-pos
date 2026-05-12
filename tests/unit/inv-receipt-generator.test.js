const {
  generateReceipt,
  generateReceiptNumber,
  formatReceiptDate,
  DEFAULT_COMPANY_INFO,
  TERMS_TEXT,
  SECOND_HAND_TERMS_TEXT,
  QR_CODE_URL,
} = require('../../utils/inv-receipt-generator');

// ─── generateReceiptNumber ───────────────────────────────────────────

describe('generateReceiptNumber', () => {
  it('should generate a receipt number in S-YYYYMMDDHHmmss-XXXXXXXX format', () => {
    const date = new Date(2026, 3, 28, 15, 54, 15); // April 28, 2026 15:54:15
    const result = generateReceiptNumber(date);
    expect(result).toMatch(/^S-\d{14}-[0-9A-F]{8}$/);
    expect(result).toContain('20260428155415');
  });

  it('should zero-pad single-digit months, days, hours, minutes, seconds', () => {
    const date = new Date(2026, 0, 5, 3, 7, 9); // Jan 5, 2026 03:07:09
    const result = generateReceiptNumber(date);
    expect(result).toMatch(/^S-\d{14}-[0-9A-F]{8}$/);
    expect(result).toContain('20260105030709');
  });

  it('should handle midnight correctly', () => {
    const date = new Date(2026, 11, 31, 0, 0, 0); // Dec 31, 2026 00:00:00
    const result = generateReceiptNumber(date);
    expect(result).toMatch(/^S-\d{14}-[0-9A-F]{8}$/);
    expect(result).toContain('20261231000000');
  });

  it('should handle end of day correctly', () => {
    const date = new Date(2026, 5, 15, 23, 59, 59); // Jun 15, 2026 23:59:59
    const result = generateReceiptNumber(date);
    expect(result).toMatch(/^S-\d{14}-[0-9A-F]{8}$/);
    expect(result).toContain('20260615235959');
  });

  it('should produce a 25-character string with type prefix and hex suffix', () => {
    const date = new Date(2026, 3, 28, 15, 54, 15);
    const result = generateReceiptNumber(date);
    expect(result).toHaveLength(25);
    expect(result).toMatch(/^S-\d{14}-[0-9A-F]{8}$/);
  });

  it('should throw for invalid date', () => {
    expect(() => generateReceiptNumber(new Date('invalid'))).toThrow('Invalid date');
  });

  it('should throw for non-Date input', () => {
    expect(() => generateReceiptNumber('2026-04-28')).toThrow('Invalid date');
    expect(() => generateReceiptNumber(null)).toThrow('Invalid date');
  });
});

// ─── formatReceiptDate ───────────────────────────────────────────────

describe('formatReceiptDate', () => {
  it('should format date as DD/MM/YYYY HH:mm:ss', () => {
    const date = new Date(2026, 3, 28, 15, 54, 15);
    expect(formatReceiptDate(date)).toBe('28/04/2026 15:54:15');
  });

  it('should zero-pad components', () => {
    const date = new Date(2026, 0, 5, 3, 7, 9);
    expect(formatReceiptDate(date)).toBe('05/01/2026 03:07:09');
  });
});

// ─── generateReceipt — content completeness ──────────────────────────

describe('generateReceipt', () => {
  const baseTransaction = {
    receiptNumber: '20260428155415',
    createdAt: new Date(2026, 3, 28, 15, 54, 15),
    items: [
      {
        name: 'iPhone 15 Screen Protector',
        quantity: 2,
        unitPrice: 15.00,
        discountedPrice: 15.00,
        subtotal: 30.00,
        isSecondHand: false,
        costPrice: 5.00,
      },
    ],
    totalAmount: 30.00,
    paymentMethod: 'cash',
    cashReceived: 50.00,
    changeGiven: 20.00,
    standardVatTotal: 5.61,
    marginVatTotal: 0,
  };

  it('should include company name, logo, address, and phone', () => {
    const receipt = generateReceipt(baseTransaction);
    expect(receipt.companyName).toBe('Tech Cross Repair Centre');
    expect(receipt.companyLogo).toBe('logo.png');
    expect(receipt.companyAddress).toBe('Unit 4, Navan Shopping Centre, Navan, Co. Meath, C15 F658, Ireland');
    expect(receipt.companyPhone).toBe('046 905 9854');
  });

  it('should allow overriding company info', () => {
    const custom = { name: 'Custom Shop', phone: '123-456' };
    const receipt = generateReceipt(baseTransaction, custom);
    expect(receipt.companyName).toBe('Custom Shop');
    expect(receipt.companyPhone).toBe('123-456');
    // Non-overridden fields keep defaults
    expect(receipt.companyLogo).toBe('logo.png');
    expect(receipt.companyAddress).toBe('Unit 4, Navan Shopping Centre, Navan, Co. Meath, C15 F658, Ireland');
  });

  it('should include receipt number and formatted date', () => {
    const receipt = generateReceipt(baseTransaction);
    expect(receipt.receiptNumber).toBe('20260428155415');
    expect(receipt.date).toBe('28/04/2026 15:54:15');
  });

  it('should include all item details', () => {
    const receipt = generateReceipt(baseTransaction);
    expect(receipt.items).toHaveLength(1);
    expect(receipt.items[0]).toEqual({
      name: 'iPhone 15 Screen Protector',
      quantity: 2,
      unitPrice: 15.00,
      discountedPrice: 15.00,
      subtotal: 30.00,
      isSecondHand: false,
    });
  });

  it('should include totalAmount, paymentMethod, cashReceived, changeGiven', () => {
    const receipt = generateReceipt(baseTransaction);
    expect(receipt.totalAmount).toBe(30.00);
    expect(receipt.paymentMethod).toBe('cash');
    expect(receipt.cashReceived).toBe(50.00);
    expect(receipt.changeGiven).toBe(20.00);
  });

  it('should include VAT totals', () => {
    const receipt = generateReceipt(baseTransaction);
    expect(receipt.standardVatTotal).toBe(5.61);
    expect(receipt.marginVatTotal).toBe(0);
  });

  it('should include terms text', () => {
    const receipt = generateReceipt(baseTransaction);
    expect(receipt.termsText).toBe(TERMS_TEXT);
    expect(receipt.termsText).toContain('7-day refund policy');
  });

  it('should include second-hand terms text', () => {
    const receipt = generateReceipt(baseTransaction);
    expect(receipt.secondHandTermsText).toBe(SECOND_HAND_TERMS_TEXT);
    expect(receipt.secondHandTermsText).toContain('IMPORTANT');
  });

  it('should include QR code URL', () => {
    const receipt = generateReceipt(baseTransaction);
    expect(receipt.qrCodeUrl).toBe('https://techcross.ie/receipt-terms.html');
  });

  it('should set hasSecondHandItems to false when no second-hand items', () => {
    const receipt = generateReceipt(baseTransaction);
    expect(receipt.hasSecondHandItems).toBe(false);
  });

  it('should throw when transaction is missing', () => {
    expect(() => generateReceipt(null)).toThrow('Transaction data is required');
    expect(() => generateReceipt(undefined)).toThrow('Transaction data is required');
  });

  // ─── Card payment ────────────────────────────────────────────────

  it('should handle card payment (no cashReceived/changeGiven)', () => {
    const cardTx = {
      ...baseTransaction,
      paymentMethod: 'card',
      cashReceived: null,
      changeGiven: null,
    };
    const receipt = generateReceipt(cardTx);
    expect(receipt.paymentMethod).toBe('card');
    expect(receipt.cashReceived).toBeNull();
    expect(receipt.changeGiven).toBeNull();
  });

  // ─── Discount info ───────────────────────────────────────────────

  it('should include item-level discount info', () => {
    const txWithDiscount = {
      ...baseTransaction,
      items: [
        {
          name: 'iPhone Case',
          quantity: 1,
          unitPrice: 20.00,
          discountedPrice: 18.00,
          subtotal: 18.00,
          isSecondHand: false,
          discount: { type: 'fixed', value: 2 },
        },
      ],
    };
    const receipt = generateReceipt(txWithDiscount);
    expect(receipt.discountInfo.itemDiscounts).toHaveLength(1);
    expect(receipt.discountInfo.itemDiscounts[0]).toEqual({
      itemName: 'iPhone Case',
      discountType: 'fixed',
      discountValue: 2,
      originalPrice: 20.00,
      discountedPrice: 18.00,
    });
  });

  it('should include order-level discount info', () => {
    const txWithOrderDiscount = {
      ...baseTransaction,
      orderDiscount: { type: 'percentage', value: 10 },
    };
    const receipt = generateReceipt(txWithOrderDiscount);
    expect(receipt.discountInfo.orderDiscount).toEqual({
      discountType: 'percentage',
      discountValue: 10,
    });
  });

  it('should set orderDiscount to null when no order discount', () => {
    const receipt = generateReceipt(baseTransaction);
    expect(receipt.discountInfo.orderDiscount).toBeNull();
  });
});

// ─── generateReceipt — second-hand items ─────────────────────────────

describe('generateReceipt — second-hand items', () => {
  it('should set hasSecondHandItems to true when transaction contains second-hand items', () => {
    const tx = {
      receiptNumber: '20260428160000',
      createdAt: new Date(2026, 3, 28, 16, 0, 0),
      items: [
        {
          name: 'iPhone 14 Pro (Used)',
          quantity: 1,
          unitPrice: 500.00,
          discountedPrice: 500.00,
          subtotal: 500.00,
          isSecondHand: true,
          serialNumber: '123456789012345',
          costPrice: 300.00,
        },
      ],
      totalAmount: 500.00,
      paymentMethod: 'cash',
      cashReceived: 500.00,
      changeGiven: 0,
      standardVatTotal: 0,
      marginVatTotal: 37.40,
    };

    const receipt = generateReceipt(tx);
    expect(receipt.hasSecondHandItems).toBe(true);
    expect(receipt.items[0].serialNumber).toBe('123456789012345');
    expect(receipt.items[0].isSecondHand).toBe(true);
    expect(receipt.secondHandTermsText).toContain('IMPORTANT');
    expect(receipt.secondHandTermsText).toContain('Apple ID');
    expect(receipt.secondHandTermsText).toContain('Warranty covers hardware defects only');
  });

  it('should include serialNumber only when present', () => {
    const tx = {
      receiptNumber: '20260428160100',
      createdAt: new Date(2026, 3, 28, 16, 1, 0),
      items: [
        {
          name: 'USB Cable',
          quantity: 3,
          unitPrice: 5.00,
          discountedPrice: 5.00,
          subtotal: 15.00,
          isSecondHand: false,
        },
      ],
      totalAmount: 15.00,
      paymentMethod: 'card',
      standardVatTotal: 2.80,
      marginVatTotal: 0,
    };

    const receipt = generateReceipt(tx);
    expect(receipt.items[0]).not.toHaveProperty('serialNumber');
    expect(receipt.hasSecondHandItems).toBe(false);
  });

  it('should handle mixed second-hand and new items', () => {
    const tx = {
      receiptNumber: '20260428160200',
      createdAt: new Date(2026, 3, 28, 16, 2, 0),
      items: [
        {
          name: 'Screen Protector',
          quantity: 1,
          unitPrice: 10.00,
          discountedPrice: 10.00,
          subtotal: 10.00,
          isSecondHand: false,
        },
        {
          name: 'Samsung S23 (Used)',
          quantity: 1,
          unitPrice: 400.00,
          discountedPrice: 400.00,
          subtotal: 400.00,
          isSecondHand: true,
          serialNumber: 'R5CT12345678',
          costPrice: 250.00,
        },
      ],
      totalAmount: 410.00,
      paymentMethod: 'cash',
      cashReceived: 420.00,
      changeGiven: 10.00,
      standardVatTotal: 1.87,
      marginVatTotal: 28.05,
    };

    const receipt = generateReceipt(tx);
    expect(receipt.hasSecondHandItems).toBe(true);
    expect(receipt.items).toHaveLength(2);
    expect(receipt.items[0]).not.toHaveProperty('serialNumber');
    expect(receipt.items[1].serialNumber).toBe('R5CT12345678');
  });
});
