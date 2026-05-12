/**
 * Transaction Query & Reporting Service (READ ONLY LAYER)
 *
 * Pure read-only queries — never modifies data, never recalculates VAT.
 * All VAT figures come from stored transaction values (standardVatTotal,
 * marginVatTotal, item.vatAmount, item.marginVat).
 *
 * Device profit/loss comes from the Device model (buyPrice, sellPrice),
 * NOT from transaction items — per SYSTEM_SPEC §2.4 (Device Asset Layer
 * is separate from inventory/transactions).
 *
 * Data sources:
 *   - Transaction model — sales, refunds, VAT, payment data
 *   - CashLedger model  — cash flow (source of financial truth per §2.2)
 *   - Device model      — asset lifecycle, buy/sell prices
 */

const Transaction = require('../models/inv/Transaction');
const CashLedger = require('../models/inv/CashLedger');
const { Device } = require('../models/inv/Device');

// ─── Helpers ─────────────────────────────────────────────────────────

const R = v => Math.round(v * 100) / 100;

function toDate(v) {
  if (v instanceof Date) return v;
  if (v == null) return null;
  const d = new Date(v);
  return isNaN(d.getTime()) ? null : d;
}

function setDayEnd(d) {
  const e = new Date(d);
  e.setUTCHours(23, 59, 59, 999);
  return e;
}

// ─── Receipt prefix lookup ───────────────────────────────────────────
// Transaction type → receipt prefix mapping (mirrors inv-receipt-number)
const TYPE_PREFIX = {
  sale: 'S-',
  refund: 'R-',
  quick_sale: 'Q-',
  device_sale: 'DS-',
  service: 'S-',     // same prefix as sale; distinguished by item vatRate
};

/**
 * Build a DB-level MongoDB filter from query parameters.
 *
 * DB-level filters (applied to the query):
 *   - date range
 *   - payment method
 *   - receipt type prefix (via $regex on receiptNumber)
 *
 * Item-level filters (vatType, service vs sale) are handled
 * in-memory after fetching — see _filterItemsByVatType() and
 * the type resolution in queryTransactions().
 *
 * @param {Object} filters
 * @param {string[]} [filters.types]     — Transaction types to include
 * @param {string}  [filters.paymentMethod] — 'cash' | 'card' | 'split'
 * @param {string|Date} [filters.startDate] — ISO date or Date
 * @param {string|Date} [filters.endDate]   — ISO date or Date
 * @returns {Object} MongoDB filter object
 */
function buildTxnFilter(filters = {}) {
  const { types, paymentMethod, startDate, endDate } = filters;
  const match = {};

  // ── Date range ──────────────────────────────────────────────────
  const sd = toDate(startDate);
  const ed = toDate(endDate);
  if (sd || ed) {
    match.createdAt = {};
    if (sd) match.createdAt.$gte = sd;
    if (ed) match.createdAt.$lte = setDayEnd(ed);
  }

  // ── Payment method ──────────────────────────────────────────────
  if (paymentMethod && ['cash', 'card', 'split'].includes(paymentMethod)) {
    match.paymentMethod = paymentMethod;
  }

  // ── Type → receipt prefix ───────────────────────────────────────
  if (types && types.length > 0) {
    const patterns = [];
    if (types.includes('sale'))        patterns.push('^S-');
    if (types.includes('refund'))      patterns.push('^R-');
    if (types.includes('quick_sale'))  patterns.push('^Q-');
    if (types.includes('device_sale')) patterns.push('^DS-');
    if (types.includes('service'))     patterns.push('^S-');

    if (patterns.length > 0) {
      const unique = [...new Set(patterns)];
      if (unique.length === 1) {
        match.receiptNumber = { $regex: unique[0] };
      } else {
        match.$or = unique.map(p => ({ receiptNumber: { $regex: p } }));
      }
    }
  }

  return match;
}

/**
 * In-memory filter: separate service transactions from regular sales.
 *
 * Service transactions have S- prefix but their items carry vatRate ≈ 0.135.
 * Regular sale transactions carry vatRate ≈ 0.23 (or marginScheme).
 */
function _filterServiceTxns(txns) {
  return txns.filter(t =>
    t.receiptNumber.startsWith('S-')
    && (t.items || []).some(i => !i.marginScheme && Math.abs((i.vatRate || 0.23) - 0.135) < 0.01),
  );
}

function _filterNonServiceTxns(txns) {
  return txns.filter(t => {
    if (!t.receiptNumber.startsWith('S-')) return true;
    return !(t.items || []).every(i => !i.marginScheme && Math.abs((i.vatRate || 0.23) - 0.135) < 0.01);
  });
}

/**
 * In-memory filter: keep only transactions that have at least one
 * item matching the specified VAT type.
 */
function _filterByVatType(txns, vatType) {
  return txns.filter(t => {
    const items = t.items || [];
    switch (vatType) {
      case 'standard23':
        return items.some(i => !i.marginScheme && Math.abs((i.vatRate || 0.23) - 0.23) < 0.01);
      case 'reduced135':
        return items.some(i => !i.marginScheme && Math.abs((i.vatRate || 0.23) - 0.135) < 0.01);
      case 'margin':
        return items.some(i => i.marginScheme);
      default:
        return true;
    }
  });
}

// ─── Public API ──────────────────────────────────────────────────────

/**
 * Query transactions with filters.
 *
 * @param {Object} [filters]
 * @param {string[]} [filters.types]
 * @param {string}  [filters.paymentMethod]
 * @param {string|Date} [filters.startDate]
 * @param {string|Date} [filters.endDate]
 * @param {string}  [filters.vatType]  — 'standard23' | 'reduced135' | 'margin'
 * @returns {Promise<Object[]>} Lean Transaction documents
 */
async function queryTransactions(filters = {}) {
  const match = buildTxnFilter(filters);
  let results = await Transaction.find(match).sort({ createdAt: -1 }).lean();

  // ── In-memory: separate service vs sale (same S- prefix) ────────
  const { types } = filters;
  if (types) {
    const wantService = types.includes('service');
    const wantSale = types.includes('sale');

    if (wantService && !wantSale) {
      results = _filterServiceTxns(results);
    } else if (wantSale && !wantService) {
      results = _filterNonServiceTxns(results);
    }
    // both — no filtering needed
  }

  // ── In-memory: VAT type filter ──────────────────────────────────
  if (filters.vatType) {
    results = _filterByVatType(results, filters.vatType);
  }

  return results;
}

/**
 * Aggregate a set of transaction documents into summary statistics.
 *
 * Reads only from stored values — NEVER recalculates VAT:
 *   - txn.totalAmount        (total sale/refund amount)
 *   - txn.standardVatTotal   (stored standard VAT total)
 *   - txn.marginVatTotal     (stored margin VAT total)
 *   - txn.paymentMethod      (cash / card / split)
 *   - txn.cardAmount         (card portion of split)
 *   - item.vatAmount         (per-item standard VAT)
 *   - item.marginVat         (per-item margin VAT)
 *   - item.subtotal          (per-item line total)
 *   - item.vatRate           (for category breakdown)
 *   - item.marginScheme      (for margin category)
 *
 * @param {Object[]} transactions — Array of lean Transaction documents
 * @returns {Object} Aggregated summary
 */
function aggregateTransactions(transactions) {
  let grossSales = 0;
  let refundTotal = 0;
  let refundCount = 0;
  let cashTotal = 0;
  let cardTotal = 0;
  let splitCash = 0;
  let splitCard = 0;
  let std23Sales = 0;
  let std23Vat = 0;
  let red135Sales = 0;
  let red135Vat = 0;
  let marginSales = 0;
  let marginVat = 0;
  const marginItems = [];

  for (const txn of transactions) {
    const isRefund = txn.totalAmount < 0;
    if (isRefund) {
      refundTotal += txn.totalAmount;
      refundCount++;
    } else {
      grossSales += txn.totalAmount;
    }

    // Payment breakdown
    if (txn.paymentMethod === 'cash') {
      cashTotal += txn.totalAmount;
    } else if (txn.paymentMethod === 'card') {
      cardTotal += txn.totalAmount;
    } else if (txn.paymentMethod === 'split') {
      splitCard += txn.cardAmount || 0;
      splitCash += txn.totalAmount - (txn.cardAmount || 0);
    }

    // Item-level VAT breakdown (per-item stored values — no recalculation)
    for (const item of txn.items || []) {
      if (item.marginScheme) {
        marginSales += item.subtotal || 0;
        marginVat += item.marginVat || 0;
        marginItems.push({
          receiptNumber: txn.receiptNumber,
          name: item.name,
          sku: item.sku || '',
          costPrice: item.costPrice || 0,
          sellingPrice: item.unitPrice || 0,
          discountedPrice: item.discountedPrice || item.unitPrice || 0,
          margin: R((item.discountedPrice || item.unitPrice || 0) - (item.costPrice || 0)),
          vatPayable: item.marginVat || 0,
          quantity: item.quantity || 1,
          marginScheme: true,
        });
      } else if (Math.abs((item.vatRate || 0.23) - 0.135) < 0.01) {
        red135Sales += item.subtotal || 0;
        red135Vat += item.vatAmount || 0;
      } else {
        std23Sales += item.subtotal || 0;
        std23Vat += item.vatAmount || 0;
      }
    }
  }

  return {
    summary: {
      transactionCount: transactions.length,
      grossSales: R(grossSales),
      refundTotal: R(refundTotal),
      refundCount,
      netSales: R(grossSales + refundTotal),
    },
    payment: {
      cash: R(cashTotal + splitCash),
      card: R(cardTotal + splitCard),
      split: { cash: R(splitCash), card: R(splitCard) },
    },
    vat: {
      standard23: { sales: R(std23Sales), vat: R(std23Vat) },
      reduced135: { sales: R(red135Sales), vat: R(red135Vat) },
      margin: { sales: R(marginSales), vat: R(marginVat), items: marginItems },
      totalVat: R(std23Vat + red135Vat + marginVat),
    },
  };
}

/**
 * Query Cash Ledger entries with filters.
 *
 * @param {Object} [filters]
 * @param {string[]} [filters.entryTypes] — e.g. ['sale', 'refund', 'expense']
 * @param {string}  [filters.direction]   — 'in' | 'out'
 * @param {string}  [filters.paymentMethod]
 * @param {string|Date} [filters.startDate]
 * @param {string|Date} [filters.endDate]
 * @returns {Promise<Object[]>} Lean CashLedger documents
 */
async function queryCashLedger(filters = {}) {
  const { entryTypes, direction, paymentMethod, startDate, endDate } = filters;
  const match = {};

  const sd = toDate(startDate);
  const ed = toDate(endDate);
  if (sd || ed) {
    match.createdAt = {};
    if (sd) match.createdAt.$gte = sd;
    if (ed) match.createdAt.$lte = setDayEnd(ed);
  }

  if (direction && ['in', 'out'].includes(direction)) {
    match.direction = direction;
  }

  if (paymentMethod && ['cash', 'card', 'split'].includes(paymentMethod)) {
    match.paymentMethod = paymentMethod;
  }

  if (entryTypes && entryTypes.length > 0) {
    match.entryType = { $in: entryTypes };
  }

  return CashLedger.find(match).sort({ createdAt: -1 }).lean();
}

/**
 * Query device profit/loss from the Device asset model.
 *
 * Per SYSTEM_SPEC §2.4: Device Asset Layer is separate from inventory.
 * Profit = sellPrice - buyPrice for devices with status 'SOLD'.
 *
 * @param {Object} [filters]
 * @param {string|Date} [filters.startDate] — filter by sell date
 * @param {string|Date} [filters.endDate]
 * @param {string} [filters.status]  — default 'SOLD'
 * @returns {Promise<Object>} { totalBuyPrice, totalSellPrice, grossProfit, count, devices[] }
 */
async function queryDeviceProfitLoss(filters = {}) {
  const { startDate, endDate, status } = filters;
  const match = { status: status || 'SOLD' };

  const sd = toDate(startDate);
  const ed = toDate(endDate);
  if (sd || ed) {
    match.updatedAt = {};
    if (sd) match.updatedAt.$gte = sd;
    if (ed) match.updatedAt.$lte = setDayEnd(ed);
  }

  const devices = await Device.find(match).lean();

  let totalBuy = 0;
  let totalSell = 0;
  let profitCount = 0;

  for (const d of devices) {
    const buy = d.buyPrice || 0;
    const sell = d.sellPrice || 0;
    totalBuy += buy;
    totalSell += sell;
    if (sell > 0) profitCount++;
  }

  return {
    totalBuyPrice: R(totalBuy),
    totalSellPrice: R(totalSell),
    grossProfit: R(totalSell - totalBuy),
    count: devices.length,
    soldCount: profitCount,
    devices: devices.map(d => ({
      serialNumber: d.serialNumber,
      status: d.status,
      buyPrice: d.buyPrice || 0,
      sellPrice: d.sellPrice || 0,
      profit: R((d.sellPrice || 0) - (d.buyPrice || 0)),
      product: d.product,
      source: d.source,
    })),
  };
}

module.exports = {
  buildTxnFilter,
  queryTransactions,
  aggregateTransactions,
  queryCashLedger,
  queryDeviceProfitLoss,
};
