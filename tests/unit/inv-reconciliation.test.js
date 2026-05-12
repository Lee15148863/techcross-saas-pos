/**
 * Unit tests for data reconciliation engine (utils/inv-reconciliation.js)
 *
 * Tests the pure computation functions: computeStockDiscrepancies,
 * computeReportDiscrepancies, and computeVatDiscrepancies.
 * These functions contain the core reconciliation logic without DB dependencies.
 */
const {
  computeStockDiscrepancies,
  computeReportDiscrepancies,
  computeVatDiscrepancies
} = require('../../utils/inv-reconciliation');

// ═══════════════════════════════════════════════════════════════════════════════
// computeStockDiscrepancies
// ═══════════════════════════════════════════════════════════════════════════════
describe('computeStockDiscrepancies', () => {
  it('should return empty array when no products provided', () => {
    const result = computeStockDiscrepancies([], [], []);
    expect(result).toEqual([]);
  });

  it('should return no discrepancy when stock matches net movements', () => {
    const products = [
      { _id: 'p1', name: 'iPhone 15', sku: 'SJ-APP15-128G-2025', stock: 10 }
    ];
    const entryAgg = [{ _id: 'p1', totalEntry: 15 }];
    const exitAgg = [{ _id: 'p1', totalExit: 5 }];

    const result = computeStockDiscrepancies(products, entryAgg, exitAgg);
    expect(result).toHaveLength(1);
    expect(result[0]).toEqual({
      productId: 'p1',
      name: 'iPhone 15',
      sku: 'SJ-APP15-128G-2025',
      expectedStock: 10,
      actualStock: 10,
      difference: 0
    });
  });

  it('should detect positive discrepancy (actual > expected)', () => {
    const products = [
      { _id: 'p1', name: 'Case', sku: 'PJ-CASE-BLK-2025', stock: 20 }
    ];
    const entryAgg = [{ _id: 'p1', totalEntry: 15 }];
    const exitAgg = [];

    const result = computeStockDiscrepancies(products, entryAgg, exitAgg);
    expect(result[0].expectedStock).toBe(15);
    expect(result[0].actualStock).toBe(20);
    expect(result[0].difference).toBe(5);
  });

  it('should detect negative discrepancy (actual < expected)', () => {
    const products = [
      { _id: 'p1', name: 'Charger', sku: 'PJ-CHG-USB-2025', stock: 3 }
    ];
    const entryAgg = [{ _id: 'p1', totalEntry: 10 }];
    const exitAgg = [{ _id: 'p1', totalExit: 2 }];

    const result = computeStockDiscrepancies(products, entryAgg, exitAgg);
    expect(result[0].expectedStock).toBe(8);
    expect(result[0].actualStock).toBe(3);
    expect(result[0].difference).toBe(-5);
  });

  it('should handle products with no stock movements', () => {
    const products = [
      { _id: 'p1', name: 'New Item', sku: 'PJ-NEW-001-2025', stock: 5 }
    ];

    const result = computeStockDiscrepancies(products, [], []);
    expect(result[0].expectedStock).toBe(0);
    expect(result[0].actualStock).toBe(5);
    expect(result[0].difference).toBe(5);
  });

  it('should handle multiple products with mixed discrepancies', () => {
    const products = [
      { _id: 'p1', name: 'Product A', sku: 'SKU-A', stock: 10 },
      { _id: 'p2', name: 'Product B', sku: 'SKU-B', stock: 5 },
      { _id: 'p3', name: 'Product C', sku: 'SKU-C', stock: 0 }
    ];
    const entryAgg = [
      { _id: 'p1', totalEntry: 10 },
      { _id: 'p2', totalEntry: 8 },
      { _id: 'p3', totalEntry: 3 }
    ];
    const exitAgg = [
      { _id: 'p2', totalExit: 3 },
      { _id: 'p3', totalExit: 3 }
    ];

    const result = computeStockDiscrepancies(products, entryAgg, exitAgg);
    expect(result).toHaveLength(3);
    // p1: expected=10, actual=10, diff=0
    expect(result[0].difference).toBe(0);
    // p2: expected=5, actual=5, diff=0
    expect(result[1].difference).toBe(0);
    // p3: expected=0, actual=0, diff=0
    expect(result[2].difference).toBe(0);
  });

  it('should handle negative expected stock (more exits than entries)', () => {
    const products = [
      { _id: 'p1', name: 'Glitch Item', sku: 'SKU-G', stock: 0 }
    ];
    const entryAgg = [{ _id: 'p1', totalEntry: 2 }];
    const exitAgg = [{ _id: 'p1', totalExit: 5 }];

    const result = computeStockDiscrepancies(products, entryAgg, exitAgg);
    expect(result[0].expectedStock).toBe(-3);
    expect(result[0].actualStock).toBe(0);
    expect(result[0].difference).toBe(3);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// computeReportDiscrepancies
// ═══════════════════════════════════════════════════════════════════════════════
describe('computeReportDiscrepancies', () => {
  it('should return zero totals when no transactions exist', () => {
    const result = computeReportDiscrepancies([], [], '2025-01-01', '2025-01-31');
    expect(result.transactionTotals.totalAmount).toBe(0);
    expect(result.reportTotals.totalAmount).toBe(0);
    expect(result.discrepancies).toHaveLength(0);
  });

  it('should show no discrepancies when totals match', () => {
    const transactions = [
      { totalAmount: 100, paymentMethod: 'cash', standardVatTotal: 18.70, marginVatTotal: 0 },
      { totalAmount: 200, paymentMethod: 'card', standardVatTotal: 37.40, marginVatTotal: 0 }
    ];
    const aggResult = [{
      totalAmount: 300,
      cashTotal: 100,
      cardTotal: 200,
      standardVatTotal: 56.10,
      marginVatTotal: 0,
      count: 2
    }];

    const result = computeReportDiscrepancies(transactions, aggResult, '2025-01-01', '2025-01-31');
    expect(result.transactionTotals.totalAmount).toBe(300);
    expect(result.reportTotals.totalAmount).toBe(300);
    // No field-level discrepancies
    const fieldDiscrepancies = result.discrepancies.filter(d => d.field !== 'paymentMethodSplit');
    expect(fieldDiscrepancies).toHaveLength(0);
  });

  it('should detect discrepancy when aggregation differs from direct sum', () => {
    const transactions = [
      { totalAmount: 100, paymentMethod: 'cash', standardVatTotal: 18.70, marginVatTotal: 0 }
    ];
    const aggResult = [{
      totalAmount: 105,
      cashTotal: 105,
      cardTotal: 0,
      standardVatTotal: 18.70,
      marginVatTotal: 0,
      count: 1
    }];

    const result = computeReportDiscrepancies(transactions, aggResult, '2025-01-01', '2025-01-31');
    expect(result.discrepancies.length).toBeGreaterThan(0);
    const totalDisc = result.discrepancies.find(d => d.field === 'totalAmount');
    expect(totalDisc).toBeDefined();
    expect(totalDisc.difference).toBe(-5);
  });

  it('should include date range in result', () => {
    const result = computeReportDiscrepancies([], [], '2025-03-15', '2025-03-20');
    expect(result.startDate).toBe('2025-03-15');
    expect(result.endDate).toBe('2025-03-20');
  });

  it('should not flag payment split discrepancy when cash + card = total', () => {
    const transactions = [
      { totalAmount: 100, paymentMethod: 'cash', standardVatTotal: 0, marginVatTotal: 0 },
      { totalAmount: 50, paymentMethod: 'card', standardVatTotal: 0, marginVatTotal: 0 }
    ];
    const aggResult = [{
      totalAmount: 150,
      cashTotal: 100,
      cardTotal: 50,
      standardVatTotal: 0,
      marginVatTotal: 0,
      count: 2
    }];

    const result = computeReportDiscrepancies(transactions, aggResult, '2025-01-01', '2025-01-31');
    const splitDisc = result.discrepancies.find(d => d.field === 'paymentMethodSplit');
    expect(splitDisc).toBeUndefined();
  });

  it('should correctly count transactions', () => {
    const transactions = [
      { totalAmount: 50, paymentMethod: 'cash', standardVatTotal: 0, marginVatTotal: 0 },
      { totalAmount: 75, paymentMethod: 'card', standardVatTotal: 0, marginVatTotal: 0 },
      { totalAmount: 25, paymentMethod: 'cash', standardVatTotal: 0, marginVatTotal: 0 }
    ];
    const aggResult = [{
      totalAmount: 150,
      cashTotal: 75,
      cardTotal: 75,
      standardVatTotal: 0,
      marginVatTotal: 0,
      count: 3
    }];

    const result = computeReportDiscrepancies(transactions, aggResult, '2025-01-01', '2025-01-31');
    expect(result.transactionTotals.transactionCount).toBe(3);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// computeVatDiscrepancies
// ═══════════════════════════════════════════════════════════════════════════════
describe('computeVatDiscrepancies', () => {
  it('should return empty discrepancies when no transactions exist', () => {
    const result = computeVatDiscrepancies([], 0.23, '2025-01-01', '2025-01-31');
    expect(result.summary.totalTransactions).toBe(0);
    expect(result.discrepancies).toHaveLength(0);
  });

  it('should show no discrepancy when VAT values match recalculation', () => {
    // Standard item: price=100, VAT = 100 * 0.23 / 1.23 = 18.70
    const transactions = [{
      _id: 'txn1',
      receiptNumber: '20250115120000',
      createdAt: new Date('2025-01-15'),
      standardVatTotal: 18.70,
      marginVatTotal: 0,
      items: [{
        name: 'Charger',
        sku: 'PJ-CHG-USB-2025',
        serialNumber: null,
        quantity: 1,
        unitPrice: 100,
        costPrice: 50,
        isSecondHand: false,
        discountedPrice: null,
        vatAmount: 18.70,
        marginVat: 0
      }]
    }];

    const result = computeVatDiscrepancies(transactions, 0.23, '2025-01-01', '2025-01-31');
    expect(result.discrepancies).toHaveLength(0);
    expect(result.summary.standardVatDifference).toBe(0);
  });

  it('should detect VAT discrepancy for standard item', () => {
    // Standard item: price=100, correct VAT = 18.70, but recorded as 20.00
    const transactions = [{
      _id: 'txn1',
      receiptNumber: '20250115120000',
      createdAt: new Date('2025-01-15'),
      standardVatTotal: 20.00,
      marginVatTotal: 0,
      items: [{
        name: 'Charger',
        sku: 'PJ-CHG-USB-2025',
        serialNumber: null,
        quantity: 1,
        unitPrice: 100,
        costPrice: 50,
        isSecondHand: false,
        discountedPrice: null,
        vatAmount: 20.00,
        marginVat: 0
      }]
    }];

    const result = computeVatDiscrepancies(transactions, 0.23, '2025-01-01', '2025-01-31');
    expect(result.discrepancies).toHaveLength(1);
    expect(result.discrepancies[0].transactionId).toBe('txn1');
    expect(result.discrepancies[0].itemDiscrepancies).toHaveLength(1);
    expect(result.discrepancies[0].itemDiscrepancies[0].recordedVatAmount).toBe(20.00);
    expect(result.discrepancies[0].itemDiscrepancies[0].recalculatedVatAmount).toBe(18.70);
  });

  it('should detect Margin VAT discrepancy for second-hand item', () => {
    // Second-hand: price=500, cost=300, margin=200
    // Correct Margin VAT = 200 * 0.23 / 1.23 = 37.40, but recorded as 40.00
    const transactions = [{
      _id: 'txn2',
      receiptNumber: '20250115130000',
      createdAt: new Date('2025-01-15'),
      standardVatTotal: 0,
      marginVatTotal: 40.00,
      items: [{
        name: 'iPhone 14 Pro',
        sku: 'SJ-APP14P-256G-2024',
        serialNumber: '123456789012345',
        quantity: 1,
        unitPrice: 500,
        costPrice: 300,
        isSecondHand: true,
        discountedPrice: null,
        vatAmount: 0,
        marginVat: 40.00
      }]
    }];

    const result = computeVatDiscrepancies(transactions, 0.23, '2025-01-01', '2025-01-31');
    expect(result.discrepancies).toHaveLength(1);
    const disc = result.discrepancies[0].itemDiscrepancies[0];
    expect(disc.isSecondHand).toBe(true);
    expect(disc.serialNumber).toBe('123456789012345');
    expect(disc.recordedMarginVat).toBe(40.00);
    expect(disc.recalculatedMarginVat).toBe(37.40);
  });

  it('should use discountedPrice when available for VAT recalculation', () => {
    // Standard item: original price=100, discounted to 80
    // VAT = 80 * 0.23 / 1.23 = 14.96
    const transactions = [{
      _id: 'txn3',
      receiptNumber: '20250115140000',
      createdAt: new Date('2025-01-15'),
      standardVatTotal: 14.96,
      marginVatTotal: 0,
      items: [{
        name: 'Screen Protector',
        sku: 'PJ-SP-IP15-2025',
        serialNumber: null,
        quantity: 1,
        unitPrice: 100,
        costPrice: 30,
        isSecondHand: false,
        discountedPrice: 80,
        vatAmount: 14.96,
        marginVat: 0
      }]
    }];

    const result = computeVatDiscrepancies(transactions, 0.23, '2025-01-01', '2025-01-31');
    expect(result.discrepancies).toHaveLength(0);
  });

  it('should include summary totals in result', () => {
    const transactions = [{
      _id: 'txn1',
      receiptNumber: '20250115120000',
      createdAt: new Date('2025-01-15'),
      standardVatTotal: 18.70,
      marginVatTotal: 37.40,
      items: [
        {
          name: 'Charger', sku: 'PJ-CHG', serialNumber: null,
          quantity: 1, unitPrice: 100, costPrice: 50,
          isSecondHand: false, discountedPrice: null,
          vatAmount: 18.70, marginVat: 0
        },
        {
          name: 'iPhone 14', sku: 'SJ-APP14', serialNumber: 'IMEI123',
          quantity: 1, unitPrice: 500, costPrice: 300,
          isSecondHand: true, discountedPrice: null,
          vatAmount: 0, marginVat: 37.40
        }
      ]
    }];

    const result = computeVatDiscrepancies(transactions, 0.23, '2025-01-01', '2025-01-31');
    expect(result.summary.totalTransactions).toBe(1);
    expect(result.summary.recordedStandardVatTotal).toBe(18.70);
    expect(result.summary.recordedMarginVatTotal).toBe(37.40);
    expect(result.startDate).toBe('2025-01-01');
    expect(result.endDate).toBe('2025-01-31');
  });

  it('should handle quantity > 1 correctly in VAT recalculation', () => {
    // 2 units at 100 each, standard VAT per unit = 18.70, total = 37.40
    const transactions = [{
      _id: 'txn4',
      receiptNumber: '20250115150000',
      createdAt: new Date('2025-01-15'),
      standardVatTotal: 37.40,
      marginVatTotal: 0,
      items: [{
        name: 'Cable', sku: 'PJ-CBL-USB-2025', serialNumber: null,
        quantity: 2, unitPrice: 100, costPrice: 40,
        isSecondHand: false, discountedPrice: null,
        vatAmount: 37.40, marginVat: 0
      }]
    }];

    const result = computeVatDiscrepancies(transactions, 0.23, '2025-01-01', '2025-01-31');
    expect(result.discrepancies).toHaveLength(0);
  });

  it('should handle second-hand item with loss (negative margin)', () => {
    // Second-hand: price=200, cost=300, margin=-100 → VAT should be 0
    const transactions = [{
      _id: 'txn5',
      receiptNumber: '20250115160000',
      createdAt: new Date('2025-01-15'),
      standardVatTotal: 0,
      marginVatTotal: 0,
      items: [{
        name: 'Old Phone', sku: 'SJ-OLD-001-2024', serialNumber: 'SN999',
        quantity: 1, unitPrice: 200, costPrice: 300,
        isSecondHand: true, discountedPrice: null,
        vatAmount: 0, marginVat: 0
      }]
    }];

    const result = computeVatDiscrepancies(transactions, 0.23, '2025-01-01', '2025-01-31');
    expect(result.discrepancies).toHaveLength(0);
    expect(result.summary.marginVatDifference).toBe(0);
  });

  it('should accept custom VAT rate', () => {
    // Standard item: price=100, VAT at 10% = 100 * 0.10 / 1.10 = 9.09
    const transactions = [{
      _id: 'txn6',
      receiptNumber: '20250115170000',
      createdAt: new Date('2025-01-15'),
      standardVatTotal: 9.09,
      marginVatTotal: 0,
      items: [{
        name: 'Widget', sku: 'PJ-WDG-001-2025', serialNumber: null,
        quantity: 1, unitPrice: 100, costPrice: 40,
        isSecondHand: false, discountedPrice: null,
        vatAmount: 9.09, marginVat: 0
      }]
    }];

    const result = computeVatDiscrepancies(transactions, 0.10, '2025-01-01', '2025-01-31');
    expect(result.discrepancies).toHaveLength(0);
  });
});
