/**
 * Refund Transaction Engine (Service Layer)
 *
 * Orchestrates a complete refund with:
 *   - Original transaction lookup & validation
 *   - Duplicate refund prevention
 *   - VAT reversal with correct per-item computation (standard + margin)
 *   - Atomic Transaction + CashLedger + Device lifecycle (MongoDB transaction)
 *   - Best-effort stock restoration (outside atomic block)
 *
 * All core financial records (Transaction + CashLedger) are created
 * atomically — either both succeed or neither is persisted.
 */

const mongoose = require('mongoose');
const Transaction = require('../models/inv/Transaction');
const CashLedger = require('../models/inv/CashLedger');
const { Device } = require('../models/inv/Device');
const Product = require('../models/inv/Product');
const StockMovement = require('../models/inv/StockMovement');
const AuditLog = require('../models/inv/AuditLog');
const { generateReceiptNumber } = require('../utils/inv-receipt-number');
const { authorize, SOURCES } = require('../utils/inv-integrity-layer');
const { requireSystemActive } = require('../utils/inv-system-lock');
const { encryptData } = require('../utils/inv-crypto');

/**
 * @typedef {Object} RefundInput
 * @property {string} receiptNumber  — Original sale receipt number
 * @property {Array<{product: string, quantity: number}>} [items]  — Partial refund items (omit = full refund)
 * @property {'cash'|'card'} refundMethod
 * @property {string} operator  — User ID of the operator
 * @property {string} [reason]  — Optional reason for the refund
 */

/**
 * @typedef {Object} RefundResult
 * @property {Object} transaction  — Saved refund Transaction document
 * @property {Array}   [stockErrors] — Items whose stock restoration failed
 */

/**
 * Process a refund transaction atomically.
 *
 * @param {RefundInput} input
 * @returns {Promise<RefundResult>}
 * @throws {Error} with `.code` property on validation / business-rule failure
 */
async function processRefund(input) {
  // ── 0. System safety check ─────────────────────────────────────
  await requireSystemActive();

  // ── 1. Validate input structure ──────────────────────────────────
  if (!input || typeof input !== 'object') {
    throw Object.assign(new Error('Input data is required'), { code: 'VALIDATION_ERROR' });
  }

  const { receiptNumber, items, refundMethod, reason, operator } = input;

  if (!receiptNumber) {
    throw Object.assign(new Error('Original receipt number is required for refund'), { code: 'VALIDATION_ERROR' });
  }

  if (!refundMethod || !['cash', 'card'].includes(refundMethod)) {
    throw Object.assign(new Error('Refund method must be cash or card'), { code: 'VALIDATION_ERROR' });
  }

  if (!operator) {
    throw Object.assign(new Error('Operator is required'), { code: 'VALIDATION_ERROR' });
  }

  // ── 2. Look up original transaction ─────────────────────────────
  const originalTransaction = await Transaction.findOne({ receiptNumber });
  if (!originalTransaction) {
    throw Object.assign(new Error(`Transaction not found: ${receiptNumber}`), { code: 'NOT_FOUND' });
  }

  // ── 4. Build refund items from original transaction ─────────────
  const txnItems = originalTransaction.items || [];

  let refundItems;
  if (items && items.length > 0) {
    // Partial refund: only specified items
    refundItems = [];
    for (const ri of items) {
      const found = txnItems.find(ti =>
        (ti.product && ri.product && ti.product.toString() === ri.product) || ti.name === ri.name,
      );
      if (!found) continue;
      const qty = Math.min(ri.quantity || found.quantity, found.quantity);
      refundItems.push({
        product: found.product,
        name: found.name,
        sku: found.sku || '',
        serialNumber: found.serialNumber || '',
        quantity: qty,
        unitPrice: found.discountedPrice || found.unitPrice,
        subtotal: Math.round((found.discountedPrice || found.unitPrice) * qty * 100) / 100,
        costPrice: found.costPrice || 0,
        isSecondHand: found.isSecondHand || false,
        marginScheme: found.marginScheme || false,
        vatRate: found.vatRate || 0.23,
      });
    }
  } else {
    // Full refund: reverse all items from original
    refundItems = txnItems.map(ti => ({
      product: ti.product,
      name: ti.name,
      sku: ti.sku || '',
      serialNumber: ti.serialNumber || '',
      quantity: ti.quantity,
      unitPrice: ti.discountedPrice || ti.unitPrice,
      subtotal: ti.subtotal,
      costPrice: ti.costPrice || 0,
      isSecondHand: ti.isSecondHand || false,
      marginScheme: ti.marginScheme || false,
      vatRate: ti.vatRate || 0.23,
    }));
  }

  if (refundItems.length === 0) {
    throw Object.assign(new Error('No items to refund'), { code: 'VALIDATION_ERROR' });
  }

  // ── 5. Compute VAT reversal ────────────────────────────────────
  // Each item gets properly computed negative VAT to reverse the original.
  // Standard items: vatAmount = -(price × rate / (1+rate) × qty)
  // Margin items:   marginVat = -(max(0, (price-cost)) × rate / (1+rate) × qty)
  const refundTxItems = refundItems.map(i => {
    const rate = i.vatRate || 0.23;
    let vatAmt = 0;
    let marginAmt = 0;

    if (i.marginScheme) {
      const margin = Math.max(0, i.unitPrice - (i.costPrice || 0));
      marginAmt = Math.round(margin * rate / (1 + rate) * 10000) / 10000;
      marginAmt = Math.round(marginAmt * i.quantity * 100) / 100;
    } else {
      const perUnit = Math.round(i.unitPrice * rate / (1 + rate) * 100) / 100;
      vatAmt = Math.round(perUnit * i.quantity * 100) / 100;
    }

    return {
      product: i.product,
      name: i.name,
      sku: i.sku,
      serialNumber: i.serialNumber,
      quantity: i.quantity,
      unitPrice: -i.unitPrice,
      costPrice: i.costPrice || 0,
      isSecondHand: i.isSecondHand,
      marginScheme: i.marginScheme,
      vatRate: rate,
      discountedPrice: -i.unitPrice,
      subtotal: -i.subtotal,
      vatAmount: -vatAmt,
      marginVat: -marginAmt,
    };
  });

  const totalRefund = Math.round(refundItems.reduce((s, i) => s + i.subtotal, 0) * 100) / 100;
  const totalStdVat = Math.round(refundTxItems.reduce((s, it) => s + (it.vatAmount || 0), 0) * 100) / 100;
  const totalMarginVat = Math.round(refundTxItems.reduce((s, it) => s + (it.marginVat || 0), 0) * 100) / 100;

  // ── 6. Generate refund receipt number ───────────────────────────
  const refundReceiptNumber = generateReceiptNumber('refund');

  // ── 3/7. Duplicate check + atomic with retry ────────────────────
  // MongoDB 7.0 defers unique index checks to commit time inside
  // transactions. A retry loop handles write conflicts from concurrent
  // refunds: on retry, the findOne below catches the already-committed
  // refund from the first successful attempt.
  const MAX_RETRIES_REFUND = 3;
  let transaction;

  for (let attempt = 0; attempt < MAX_RETRIES_REFUND; attempt++) {
    const existingRefund = await Transaction.findOne({
      originalReceipt: receiptNumber,
      totalAmount: { $lt: 0 },
    });
    if (existingRefund) {
      throw Object.assign(
        new Error('This order has already been refunded'),
        { code: 'ALREADY_REFUNDED' },
      );
    }

    // ── 7. Atomic: Transaction + CashLedger + Device lifecycle ──
    const session = await mongoose.startSession();
    try {
      session.startTransaction();

      // 7a. Create refund Transaction (negative amounts)
      const refundTxnDoc = authorize(new Transaction({
        receiptNumber: refundReceiptNumber,
        items: refundTxItems,
        totalAmount: -totalRefund,
        standardVatTotal: totalStdVat,
        marginVatTotal: totalMarginVat,
        paymentMethod: refundMethod,
        cashReceived: refundMethod === 'cash' ? -totalRefund : null,
        cardAmount: refundMethod === 'card' ? -totalRefund : null,
        changeGiven: refundMethod === 'cash' ? 0 : null,
        originalReceipt: receiptNumber,
        operator,
      }), SOURCES.REFUND);
      await refundTxnDoc.save({ session });
      transaction = refundTxnDoc;

      // 7b. Create CashLedger entry (financial record of money going out)
      const ledgerDoc = authorize(new CashLedger({
        entryType: 'refund',
        direction: 'out',
        amount: totalRefund,
        paymentMethod: refundMethod,
        cashReceived: refundMethod === 'cash' ? totalRefund : null,
        changeGiven: null,
        cardAmount: refundMethod === 'card' ? totalRefund : null,
        referenceType: 'transaction',
        referenceId: transaction._id,
        receiptNumber: refundReceiptNumber,
        description: `Refund - ${receiptNumber} (${refundMethod})${reason ? ' - ' + reason : ''}`,
        operator,
      }), SOURCES.REFUND);
      await ledgerDoc.save({ session });

      // 7c. Device asset lifecycle — restore SOLD devices back to TESTED inventory
      for (const item of refundTxItems) {
        if (!item.marginScheme) continue;
        if (!item.serialNumber) continue;

        const device = await Device.findOne({ serialNumber: item.serialNumber }).session(session);
        if (device) {
          device.sellPrice = undefined;
          device.sellTransaction = undefined;
          device.status = 'TESTED';
          authorize(device, SOURCES.REFUND);
          await device.save({ session });
        }
      }

      await session.commitTransaction();
      break; // success, exit retry loop
    } catch (error) {
      try { await session.abortTransaction(); } catch (_) { /* ignore */ }

      // E11000: unique index violation on originalReceipt → duplicate refund
      if (error.code === 11000) {
        throw Object.assign(new Error('This order has already been refunded'), {
          code: 'ALREADY_REFUNDED',
        });
      }

      // Write conflict from concurrent refund → retry (findOne catches it)
      const isTransient = error.errorLabels?.includes('TransientTransactionError')
        || error.code === 112
        || (error.message && (
          error.message.includes('WriteConflict') || error.message.includes('write conflict')
        ));

      if (isTransient && attempt < MAX_RETRIES_REFUND - 1) {
        await new Promise(r => setTimeout(r, 100));
        continue;
      }

      throw Object.assign(new Error(`Refund atomic transaction failed: ${error.message}`), {
        code: 'ATOMIC_FAILURE',
        original: error,
      });
    } finally {
      try { await session.endSession(); } catch (_) { /* always release */ }
    }
  }

  // ── 8. Stock restoration (best-effort, outside atomic block) ─────
  const stockErrors = [];
  for (const item of refundItems) {
    if (!item.product) continue;
    try {
      await StockMovement.create({
        product: item.product,
        type: 'entry',
        quantity: item.quantity,
        operator,
        referenceId: transaction._id.toString(),
        referenceType: 'refund',
        serialNumber: item.serialNumber || undefined,
        note: `Refund - ${refundReceiptNumber}${reason ? ' - ' + reason : ''}`,
      });

      await Product.findByIdAndUpdate(item.product, {
        $inc: { stock: item.quantity },
        updatedAt: new Date(),
      });
    } catch (stockErr) {
      console.error(`Stock restore failed for ${item.product}:`, stockErr.message);
      stockErrors.push({ product: item.product, name: item.name, quantity: item.quantity, error: stockErr.message });
    }
  }

  if (stockErrors.length > 0) {
    try {
      await AuditLog.create({
        action: 'refund_stock_restore_failed',
        operator,
        targetType: 'refund',
        targetId: transaction._id.toString(),
        encryptedData: encryptData({
          receiptNumber: refundReceiptNumber,
          originalReceipt: receiptNumber,
          stockErrors,
          timestamp: new Date().toISOString(),
        }),
      });
    } catch (auditErr) {
      console.error('Failed to write stock error audit log:', auditErr.message);
    }
  }

  return {
    transaction,
    refundItems: refundItems.map(i => ({
      product: i.product,
      name: i.name,
      quantity: i.quantity,
      unitPrice: i.unitPrice,
    })),
    totalRefund,
    refundMethod,
    originalReceipt: receiptNumber,
    ...(stockErrors.length > 0 ? { stockErrors } : {}),
  };
}

module.exports = { processRefund };
