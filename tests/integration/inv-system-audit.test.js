/**
 * FULL SYSTEM AUDIT — Scenarios A, B, C, D
 *
 * Tests all core financial integrity scenarios without stress load.
 */

const mongoose = require('mongoose');
const { MongoMemoryReplSet } = require('mongodb-memory-server');

const Product = require('../../models/inv/Product');
const Transaction = require('../../models/inv/Transaction');
const CashLedger = require('../../models/inv/CashLedger');
const { Device } = require('../../models/inv/Device');
const DailyClose = require('../../models/inv/DailyClose');
const InvUser = require('../../models/inv/User');

const { checkout } = require('../../services/inv-checkout-service');
const { processRefund } = require('../../services/inv-refund-service');
const { closeDay, getDayStatus, listClosedDays } = require('../../services/inv-daily-close-service');
const { queryTransactions, aggregateTransactions, queryCashLedger } = require('../../services/inv-query-service');

const { authorize, SOURCES } = require('../../utils/inv-integrity-layer');

const R = v => Math.round(v * 100) / 100;

let mongod, operator, products = {};

beforeAll(async () => {
  mongod = await MongoMemoryReplSet.create({
    replSet: { count: 1, storageEngine: 'wiredTiger' },
    binary: { version: '7.0.20' },
  });
  await mongoose.connect(mongod.getUri(), { dbName: 'system-audit' });

  await Promise.all([
    mongoose.connection.createCollection('transactions'),
    mongoose.connection.createCollection('cashledgers'),
    mongoose.connection.createCollection('devices'),
    mongoose.connection.createCollection('products'),
    mongoose.connection.createCollection('dailycloses'),
    mongoose.connection.createCollection('invusers'),
  ]);

  process.env.INV_AUDIT_KEY = 'test-audit-key-for-system-audit-32b!!';
  process.env.INV_JWT_SECRET = 'test-jwt-secret-for-system-audit';

  operator = await InvUser.create({
    username: 'audit-operator', password: 'n/a', displayName: 'Audit Tester', role: 'root',
  });

  const [charger, repair, pixel] = await Product.create([
    { name: 'Phone Charger', sku: 'AUDIT-PC-001', category: '配件', sellingPrice: 20, costPrice: 8, vatRate: 0.23, stock: 50 },
    { name: 'Repair Service', sku: 'AUDIT-SRV-001', category: '服务', sellingPrice: 50, costPrice: 0, vatRate: 0.135, stock: 0 },
    { name: 'Pixel 7 (Used)', sku: 'AUDIT-DEV-001', category: '二手', sellingPrice: 350, costPrice: 200, vatRate: 0.23, isSecondHand: true, marginScheme: true, stock: 5 },
  ]);
  products = { charger: charger._id.toString(), repair: repair._id.toString(), pixel: pixel._id.toString() };
  // Small delay for replica set to stabilize after collection creation
  await new Promise(r => setTimeout(r, 500));
}, 30000);

afterAll(async () => {
  try { await mongoose.disconnect(); } catch (_) {}
  if (mongod) await mongod.stop();
}, 10000);

// ─── SCENARIO A: NORMAL SALE ────────────────────────────────────────
describe('A — Normal Sale Checkout', () => {
  // Known issue: mongodb-memory-server single-node replica set has aggressive
  // 5ms transaction lock timeout. A brief delay between sequential transaction
  // tests prevents false-positive LockTimeout errors.
  const txnDelay = () => new Promise(r => setTimeout(r, 100));

  test('A1: Standard product sale with correct VAT', async () => {
    const r = await checkout({ items: [{ product: products.charger, quantity: 2 }], paymentMethod: 'cash', cashReceived: 50, operator: operator._id.toString() });
    expect(r.transaction.totalAmount).toBe(40);
    expect(r.transaction.cashReceived).toBe(50);
    expect(r.transaction.changeGiven).toBe(10);
    const expVat = R(Math.round(20 * 0.23 / 1.23 * 100) / 100 * 2);
    expect(r.transaction.standardVatTotal).toBe(expVat);
    const ledgers = await CashLedger.find({ referenceId: r.transaction._id });
    expect(ledgers).toHaveLength(1);
    expect(ledgers[0].entryType).toBe('sale');
    expect(ledgers[0].direction).toBe('in');
    expect(ledgers[0].amount).toBe(40);
  });

  test('A2: Service transaction with 13.5% VAT', async () => {
    await txnDelay();
    const r = await checkout({ items: [{ product: products.repair, quantity: 1 }], paymentMethod: 'card', operator: operator._id.toString() });
    expect(r.transaction.totalAmount).toBe(50);
    expect(r.transaction.cardAmount).toBe(50);
    const expVat = Math.round(50 * 0.135 / 1.135 * 100) / 100;
    expect(r.transaction.standardVatTotal).toBe(expVat);
  });

  test('A3: Margin scheme device sale with correct margin VAT', async () => {
    await txnDelay();
    const device = await Device.create({ serialNumber: 'AUDIT-PIXEL-001', buyPrice: 200, source: 'customer', product: products.pixel, status: 'TESTED' });
    const r = await checkout({ items: [{ product: products.pixel, quantity: 1, serialNumber: device.serialNumber }], paymentMethod: 'cash', cashReceived: 350, operator: operator._id.toString() });
    expect(r.transaction.marginVatTotal).toBeGreaterThan(0);
    const expMarginVat = Math.round((350 - 200) * 0.23 / 1.23 * 100) / 100;
    expect(r.transaction.marginVatTotal).toBe(expMarginVat);
    const updated = await Device.findById(device._id);
    expect(updated.status).toBe('SOLD');
    expect(updated.sellPrice).toBe(350);
  });

  test('A4: Split payment recorded correctly', async () => {
    await txnDelay();
    const r = await checkout({ items: [{ product: products.charger, quantity: 3 }], paymentMethod: 'split', cardAmount: 30, cashReceived: 35, operator: operator._id.toString() });
    expect(r.transaction.totalAmount).toBe(60);
    expect(r.transaction.cardAmount).toBe(30);
    expect(r.transaction.cashReceived).toBe(35);
    expect(r.transaction.changeGiven).toBe(5);
  });
});

// ─── SCENARIO B: REFUND FLOW ─────────────────────────────────────────
describe('B — Refund Flow', () => {
  let saleReceipt, saleTxn;

  beforeAll(async () => {
    const r = await checkout({ items: [{ product: products.charger, quantity: 1 }], paymentMethod: 'cash', cashReceived: 20, operator: operator._id.toString() });
    saleReceipt = r.transaction.receiptNumber;
    saleTxn = r.transaction;
  });

  test('B1: Full refund creates reverse entries', async () => {
    const r = await processRefund({ receiptNumber: saleReceipt, refundMethod: 'cash', operator: operator._id.toString(), reason: 'Changed mind' });
    expect(r.transaction.totalAmount).toBe(-20);
    expect(r.transaction.originalReceipt).toBe(saleReceipt);
    const expVat = Math.round(20 * 0.23 / 1.23 * 100) / 100;
    expect(r.transaction.standardVatTotal).toBe(-expVat);
    const ledgers = await CashLedger.find({ referenceId: r.transaction._id });
    expect(ledgers).toHaveLength(1);
    expect(ledgers[0].entryType).toBe('refund');
    expect(ledgers[0].direction).toBe('out');
    expect(ledgers[0].amount).toBe(20);
  });

  test('B2: Duplicate refund blocked', async () => {
    await expect(processRefund({ receiptNumber: saleReceipt, refundMethod: 'cash', operator: operator._id.toString() })).rejects.toMatchObject({ code: 'ALREADY_REFUNDED' });
  });

  test('B3: Non-existent transaction refund blocked', async () => {
    await expect(processRefund({ receiptNumber: 'S-NONEXIST-00000000', refundMethod: 'cash', operator: operator._id.toString() })).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });

  test('B4: Device refund restores lifecycle', async () => {
    const dev = await Device.create({ serialNumber: 'AUDIT-PIXEL-RF-001', buyPrice: 200, source: 'customer', product: products.pixel, status: 'TESTED' });
    const sale = await checkout({ items: [{ product: products.pixel, quantity: 1, serialNumber: dev.serialNumber }], paymentMethod: 'card', operator: operator._id.toString() });
    await processRefund({ receiptNumber: sale.transaction.receiptNumber, refundMethod: 'card', operator: operator._id.toString() });
    const restored = await Device.findById(dev._id);
    expect(restored.status).toBe('TESTED');
    expect(restored.sellPrice).toBeUndefined();
    expect(restored.sellTransaction).toBeUndefined();
  });

  test('B5: Partial refund prorates correctly', async () => {
    const r = await checkout({ items: [{ product: products.charger, quantity: 5 }], paymentMethod: 'card', operator: operator._id.toString() });
    const refund = await processRefund({ receiptNumber: r.transaction.receiptNumber, items: [{ product: products.charger, quantity: 2 }], refundMethod: 'card', operator: operator._id.toString() });
    expect(refund.totalRefund).toBe(40);
    expect(refund.transaction.items[0].quantity).toBe(2);
    expect(refund.transaction.items[0].unitPrice).toBe(-20);
  });
});

// ─── SCENARIO C: DAILY CLOSE ─────────────────────────────────────────
describe('C — Daily Close System', () => {
  const closeDate = new Date(Date.now() + 86400000).toISOString().split('T')[0]; // tomorrow

  test('C1: Day initially open', async () => {
    expect((await getDayStatus(closeDate)).status).toBe('open');
  });

  test('C2: Daily close verifies match', async () => {
    const r = await closeDay(closeDate, operator._id.toString());
    expect(r.snapshot.status).toBe('closed');
    expect(r.validation.transactionLedgerMatch).toBe(true);
    expect(r.validation.cashReconciliation).toBe(true);
  });

  test('C3: Re-close blocked', async () => {
    await expect(closeDay(closeDate, operator._id.toString())).rejects.toMatchObject({ code: 'ALREADY_CLOSED' });
  });

  test('C4: Closed snapshot immutable via save', async () => {
    const doc = await DailyClose.findOne({ date: closeDate });
    doc.grossSales = 999999;
    await expect(doc.save()).rejects.toThrow(/immutable/);
  });

  test('C5: findOneAndUpdate blocked', async () => {
    await expect(DailyClose.findOneAndUpdate({ date: closeDate }, { $set: { status: 'open' } })).rejects.toThrow(/cannot be updated/);
  });

  test('C6: findOneAndDelete blocked', async () => {
    await expect(DailyClose.findOneAndDelete({ date: closeDate })).rejects.toThrow(/cannot be deleted/);
  });

  test('C7: getDayStatus returns snapshot', async () => {
    expect((await getDayStatus(closeDate)).status).toBe('closed');
  });

  test('C8: listClosedDays includes the day', async () => {
    const days = await listClosedDays();
    expect(days.some(d => d.date === closeDate)).toBe(true);
  });
});

// ─── SCENARIO D: DATA TAMPERING ──────────────────────────────────────
describe('D — Data Tampering Attempts', () => {
  test('D1: Direct Transaction creation blocked', async () => {
    const t = new Transaction({ receiptNumber: 'TAMPER-001', items: [{ name: 'Test', quantity: 1, unitPrice: 10, subtotal: 10, vatAmount: 1.87 }], totalAmount: 10, standardVatTotal: 1.87, paymentMethod: 'cash', cashReceived: 10, operator: operator._id });
    await expect(t.save()).rejects.toThrow(/INTEGRITY/);
  });

  test('D2: Direct CashLedger creation blocked', async () => {
    const l = new CashLedger({ entryType: 'sale', direction: 'in', amount: 100, paymentMethod: 'cash', referenceType: 'transaction', referenceId: new mongoose.Types.ObjectId(), operator: operator._id });
    await expect(l.save()).rejects.toThrow(/INTEGRITY/);
  });

  test('D3: CashLedger edit blocked', async () => {
    const v = authorize(new CashLedger({ entryType: 'sale', direction: 'in', amount: 50, paymentMethod: 'cash', cashReceived: 50, referenceType: 'transaction', referenceId: new mongoose.Types.ObjectId(), operator: operator._id }), SOURCES.CHECKOUT);
    await v.save();
    v.amount = 999;
    await expect(v.save()).rejects.toThrow(/immutable/);
  });

  test('D4: CashLedger findOneAndUpdate blocked', async () => {
    await expect(CashLedger.findOneAndUpdate({ amount: 50 }, { $set: { amount: 999 } })).rejects.toThrow(/immutable/);
  });

  test('D5: CashLedger delete blocked', async () => {
    await expect(CashLedger.findOneAndDelete({ amount: 50 })).rejects.toThrow(/cannot be deleted/);
  });

  test('D6: Device sellPrice via findOneAndUpdate blocked', async () => {
    const d = await Device.create({ serialNumber: 'TAMPER-DEV-001', buyPrice: 100, source: 'customer' });
    await expect(Device.findOneAndUpdate({ _id: d._id }, { $set: { sellPrice: 200, sellTransaction: new mongoose.Types.ObjectId() } })).rejects.toThrow(/INTEGRITY/);
  });

  test('D7: Backward status without REFUND blocked', async () => {
    const d = await Device.create({ serialNumber: 'TAMPER-DEV-002', buyPrice: 100, source: 'customer', status: 'SOLD' });
    d.status = 'TESTED';
    await expect(d.save()).rejects.toThrow(/cannot go backward/);
  });

  test('D8: buyPrice change without ROOT_EDIT blocked', async () => {
    const d = await Device.create({ serialNumber: 'TAMPER-DEV-003', buyPrice: 150, source: 'customer' });
    d.buyPrice = 200;
    await expect(d.save()).rejects.toThrow(/INTEGRITY/);
  });

  test('D9: Query service read-only', async () => {
    const txns = await queryTransactions({});
    expect(Array.isArray(txns)).toBe(true);
    for (const t of txns) expect(t.constructor).toBe(Object);
    expect(aggregateTransactions(txns).summary).toBeDefined();
  });

  test('D10: CashLedger query returns plain objects', async () => {
    for (const e of await queryCashLedger({ entryTypes: ['sale'] })) {
      expect(e.constructor).toBe(Object);
    }
  });
});
