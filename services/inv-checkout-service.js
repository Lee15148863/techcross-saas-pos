/**
 * Checkout Transaction Engine (Service Layer)
 *
 * Orchestrates a complete sale checkout with:
 *   - Product lookup & validation
 *   - Discount & VAT calculation (delegates to discount/VAT calculators)
 *   - Payment validation & change calculation
 *   - Receipt number generation (via inv-receipt-number)
 *   - Atomic Transaction + CashLedger creation (MongoDB transaction)
 *   - Best-effort stock movement (outside atomic block — inventory is not
 *     financial truth per SYSTEM_SPEC §2.3)
 *   - Receipt data generation for printing
 *
 * All core financial records (Transaction + CashLedger) are created
 * atomically — either both succeed or neither is persisted.
 */

const mongoose = require('mongoose');
const Product = require('../models/inv/Product');
const Transaction = require('../models/inv/Transaction');
const CashLedger = require('../models/inv/CashLedger');
const { Device } = require('../models/inv/Device');
const StockMovement = require('../models/inv/StockMovement');
const AuditLog = require('../models/inv/AuditLog');
const { generateReceiptNumber } = require('../utils/inv-receipt-number');
const { generateReceipt } = require('../utils/inv-receipt-generator');
const { calculateDiscountedCart, validateDiscountFloor } = require('../utils/inv-discount-calculator');
const { DEFAULT_VAT_RATE } = require('../utils/inv-vat-calculator');
const { authorize, SOURCES } = require('../utils/inv-integrity-layer');
const { requireSystemActive } = require('../utils/inv-system-lock');
const { encryptData } = require('../utils/inv-crypto');

/**
 * @typedef {Object} CheckoutInput
 * @property {Array<{product: string, quantity: number, discount?: {type: string, value: number}}>} items
 * @property {{type: string, value: number}} [orderDiscount]
 * @property {'cash'|'card'|'split'} paymentMethod
 * @property {number} [cashReceived]  — Required for cash/split
 * @property {number} [cardAmount]    — Required for card/split
 * @property {string} operator        — User ID of the operator
 * @property {string} [discountOperator]  — User ID who approved the discount
 * @property {Object} [companyInfo]   — Optional company info override for receipt
 */

/**
 * @typedef {Object} CheckoutResult
 * @property {Object}   transaction  — Saved Transaction document
 * @property {Object|null} receiptData   — Structured receipt for printing
 * @property {Array}   [stockErrors] — Items whose stock update failed
 */

/**
 * Execute a checkout (sale) transaction atomically.
 *
 * @param {CheckoutInput} input
 * @returns {Promise<CheckoutResult>}
 * @throws {Error} with `.code` property on validation / business-rule failure
 */
async function checkout(input) {
  // ── 0. System safety check ─────────────────────────────────────
  await requireSystemActive();

  // ── 1. Validate input structure ──────────────────────────────────
  if (!input || typeof input !== 'object') {
    throw Object.assign(new Error('Input data is required'), { code: 'VALIDATION_ERROR' });
  }

  const { items, orderDiscount, paymentMethod, cashReceived, cardAmount, operator, discountOperator, companyInfo } = input;

  if (!Array.isArray(items) || items.length === 0) {
    throw Object.assign(new Error('Cart is empty'), { code: 'EMPTY_CART' });
  }

  if (!paymentMethod || !['cash', 'card', 'split'].includes(paymentMethod)) {
    throw Object.assign(new Error('Payment method must be cash, card, or split'), { code: 'VALIDATION_ERROR' });
  }

  if (!operator) {
    throw Object.assign(new Error('Operator is required'), { code: 'VALIDATION_ERROR' });
  }

  // ── 2. Pre-validate product IDs ──────────────────────────────────
  for (let i = 0; i < items.length; i++) {
    if (!items[i].product) {
      throw Object.assign(new Error(`Item at index ${i} is missing product ID`), { code: 'VALIDATION_ERROR' });
    }
  }

  // ── 3. Fetch & validate products ─────────────────────────────────
  const productIds = items.map((i) => i.product);
  const products = await Product.find({ _id: { $in: productIds } });
  const productMap = {};
  for (const p of products) productMap[p._id.toString()] = p;

  const cartItems = [];
  for (let i = 0; i < items.length; i++) {
    const item = items[i];
    const product = productMap[item.product];

    if (!product) {
      throw Object.assign(new Error(`Product not found: ${item.product}`), { code: 'NOT_FOUND' });
    }
    if (!product.active) {
      throw Object.assign(new Error(`Product is disabled: ${product.name}`), { code: 'PRODUCT_DISABLED' });
    }

    const quantity = item.quantity || 1;
    if (!Number.isInteger(quantity) || quantity <= 0) {
      throw Object.assign(new Error(`Invalid quantity for index ${i}`), { code: 'VALIDATION_ERROR' });
    }

    cartItems.push({
      product: product._id,
      name: product.name,
      sku: product.sku,
      serialNumber: product.serialNumber || item.serialNumber || '',
      quantity,
      unitPrice: product.sellingPrice,
      costPrice: product.costPrice,
      isSecondHand: product.isSecondHand || false,
      purchasedFromCustomer: product.purchasedFromCustomer || false,
      marginScheme: product.marginScheme || false,
      source: product.source || '',
      vatRate: product.vatRate || 0.23,
      discount: item.discount || null,
    });
  }

  // ── 4. Calculate discounts & VAT ─────────────────────────────────
  // marginScheme → discount-calculator uses margin VAT (device margin scheme)
  // vatRate      → 0.23 for products, 0.135 for services (set on product)
  const calcItems = cartItems.map((item) => ({
    unitPrice: item.unitPrice,
    costPrice: item.costPrice,
    quantity: item.quantity,
    isSecondHand: item.marginScheme,
    vatRate: item.vatRate,
    discount: item.discount,
  }));

  const cartResult = calculateDiscountedCart(calcItems, orderDiscount || null, DEFAULT_VAT_RATE);

  // ── 5. Discount floor check ─────────────────────────────────────
  for (let i = 0; i < cartResult.items.length; i++) {
    const calcItem = cartResult.items[i];
    const floorCheck = validateDiscountFloor(calcItem.discountedPrice, calcItem.costPrice, DEFAULT_VAT_RATE);
    if (!floorCheck.valid) {
      throw Object.assign(
        new Error(`${cartItems[i].name}: ${floorCheck.error}`),
        { code: 'DISCOUNT_BELOW_COST' },
      );
    }
  }

  // ── 6. Validate & normalise payment ──────────────────────────────
  let changeGiven;
  let cashReceivedVal = null;
  let cardAmountVal = null;

  if (paymentMethod === 'cash') {
    if (cashReceived == null || typeof cashReceived !== 'number') {
      throw Object.assign(new Error('Cash received amount is required for cash payment'), { code: 'VALIDATION_ERROR' });
    }
    if (cashReceived < cartResult.totalAmount) {
      throw Object.assign(
        new Error(`Insufficient cash: need ${cartResult.totalAmount}, received ${cashReceived}`),
        { code: 'INSUFFICIENT_PAYMENT' },
      );
    }
    cashReceivedVal = cashReceived;
    changeGiven = Math.round((cashReceived - cartResult.totalAmount) * 100) / 100;
  } else if (paymentMethod === 'card') {
    cardAmountVal = cartResult.totalAmount;
  } else {
    // split
    if (cardAmount == null || typeof cardAmount !== 'number' || cardAmount < 0) {
      throw Object.assign(new Error('Card amount is required for split payment'), { code: 'VALIDATION_ERROR' });
    }
    if (cardAmount > cartResult.totalAmount) {
      throw Object.assign(new Error('Card amount exceeds total'), { code: 'VALIDATION_ERROR' });
    }
    if (cashReceived == null || typeof cashReceived !== 'number') {
      throw Object.assign(new Error('Cash received is required for split payment'), { code: 'VALIDATION_ERROR' });
    }
    const remaining = Math.round((cartResult.totalAmount - cardAmount) * 100) / 100;
    if (cashReceived < remaining) {
      throw Object.assign(
        new Error(`Insufficient cash: card ${cardAmount}, need cash ${remaining}, received ${cashReceived}`),
        { code: 'INSUFFICIENT_PAYMENT' },
      );
    }
    cardAmountVal = cardAmount;
    cashReceivedVal = cashReceived;
    changeGiven = Math.round((cashReceived - remaining) * 100) / 100;
  }

  // ── 7. Generate receipt number ───────────────────────────────────
  const receiptNumber = generateReceiptNumber('sale');

  // ── 8. Build final transaction items ──────────────────────────────
  const transactionItems = cartItems.map((item, idx) => {
    const ci = cartResult.items[idx];
    return {
      product: item.product,
      name: item.name,
      sku: item.sku,
      serialNumber: item.serialNumber,
      quantity: item.quantity,
      unitPrice: item.unitPrice,
      costPrice: item.costPrice,
      isSecondHand: item.isSecondHand,
      purchasedFromCustomer: item.purchasedFromCustomer,
      marginScheme: item.marginScheme,
      source: item.source,
      vatRate: item.vatRate,
      discount: item.discount || undefined,
      discountedPrice: ci.discountedPrice,
      subtotal: ci.subtotal,
      vatAmount: ci.vatAmount,
      marginVat: ci.marginVat,
    };
  });

  // ── 8. Atomic: Transaction + CashLedger (with retry) ────────────────
  // MongoDB transactions can hit write conflicts under concurrent load.
  // Retry loop handles transient errors gracefully.
  const MAX_RETRIES = 3;
  let transaction;

  for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
    const session = await mongoose.startSession();
    try {
      session.startTransaction();

      const txDoc = authorize(new Transaction({
        receiptNumber,
        items: transactionItems,
        totalAmount: cartResult.totalAmount,
        subtotalBeforeOrderDiscount: cartResult.subtotalBeforeOrderDiscount,
        standardVatTotal: cartResult.standardVatTotal,
        marginVatTotal: cartResult.marginVatTotal,
        paymentMethod,
        cashReceived: cashReceivedVal,
        cardAmount: cardAmountVal,
        changeGiven,
        operator,
        discountOperator: discountOperator || undefined,
        orderDiscount:
          orderDiscount && orderDiscount.type && orderDiscount.value > 0
            ? orderDiscount
            : undefined,
      }), SOURCES.CHECKOUT);
      await txDoc.save({ session });
      transaction = txDoc;

      const ledgerDoc = authorize(new CashLedger({
        entryType: 'sale',
        direction: 'in',
        amount: cartResult.totalAmount,
        paymentMethod,
        cashReceived: cashReceivedVal,
        changeGiven: paymentMethod !== 'card' ? changeGiven : null,
        cardAmount: cardAmountVal,
        referenceType: 'transaction',
        referenceId: transaction._id,
        receiptNumber,
        description: `Sale - ${paymentMethod}`,
        operator,
      }), SOURCES.CHECKOUT);
      await ledgerDoc.save({ session });

      // ── Device asset lifecycle (marginScheme items) ────────────────
      for (const item of transactionItems) {
        if (!item.marginScheme) continue;
        const deviceData = {
          status: 'SOLD',
          sellPrice: item.discountedPrice || item.unitPrice,
          sellTransaction: transaction._id,
          product: item.product,
        };
        if (item.serialNumber) {
          const existing = await Device.findOne({ serialNumber: item.serialNumber }).session(session);
          if (existing) {
            existing.set(deviceData);
            authorize(existing, SOURCES.CHECKOUT);
            await existing.save({ session });
            continue;
          }
        }
        // No existing Device record — create from sale data (graceful migration)
        const deviceDoc = authorize(new Device({
          serialNumber: item.serialNumber || `LEGACY-${item.product}-${Date.now()}`,
          buyPrice: item.costPrice || 0,
          source: item.purchasedFromCustomer ? 'customer' : item.source || 'other',
          ...deviceData,
        }), SOURCES.CHECKOUT);
        await deviceDoc.save({ session });
      }

      await session.commitTransaction();
      break; // success, exit retry loop
    } catch (error) {
      try { await session.abortTransaction(); } catch (_) { /* ignore */ }

      // Write conflict from concurrent checkout → retry
      const isTransient = error.errorLabels?.includes('TransientTransactionError')
        || error.code === 112
        || (error.message && (
          error.message.includes('WriteConflict') || error.message.includes('write conflict')
        ));

      if (isTransient && attempt < MAX_RETRIES - 1) {
        await new Promise(r => setTimeout(r, 100));
        continue;
      }

      throw Object.assign(new Error(`Checkout atomic transaction failed: ${error.message}`), {
        code: 'ATOMIC_FAILURE',
        original: error,
      });
    } finally {
      try { await session.endSession(); } catch (_) { /* always release */ }
    }
  }

  // ── 9. Stock movements (best-effort, per SYSTEM_SPEC §2.3) ───────
  const stockErrors = [];
  for (const item of transactionItems) {
    try {
      // Skip stock movement for products with zero stock (quick sale / service items)
      const product = await Product.findById(item.product).select('stock');
      if (!product || product.stock <= 0) continue;

      await StockMovement.create({
        product: item.product,
        type: 'exit',
        quantity: item.quantity,
        operator,
        referenceId: transaction._id.toString(),
        referenceType: 'transaction',
        serialNumber: item.serialNumber || undefined,
        note: `Sale - ${receiptNumber}`,
      });

      await Product.findByIdAndUpdate(item.product, {
        $inc: { stock: -item.quantity },
        updatedAt: new Date(),
      });
    } catch (stockErr) {
      console.error(`Stock update failed for ${item.product}:`, stockErr.message);
      stockErrors.push({ product: item.product, name: item.name, quantity: item.quantity, error: stockErr.message });
    }
  }

  if (stockErrors.length > 0) {
    try {
      await AuditLog.create({
        action: 'stock_update_failed',
        operator,
        targetType: 'transaction',
        targetId: transaction._id.toString(),
        encryptedData: encryptData({ receiptNumber, stockErrors, timestamp: new Date().toISOString() }),
      });
    } catch (auditErr) {
      console.error('Failed to write stock error audit log:', auditErr.message);
    }
  }

  // ── 10. Generate receipt print data ──────────────────────────────
  let receiptData = null;
  try {
    receiptData = generateReceipt(transaction.toObject(), companyInfo);
  } catch (e) {
    console.error('Receipt generation failed:', e.message);
  }

  return {
    transaction,
    receiptData,
    ...(stockErrors.length > 0 ? { stockErrors } : {}),
  };
}

module.exports = { checkout };
