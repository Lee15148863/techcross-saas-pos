/**
 * Daily Close Service
 *
 * Implements SYSTEM_SPEC §10 (DAILY CLOSE) and §11 (DAILY SNAPSHOT).
 *
 * Process:
 *   1. Verify the day has not already been closed
 *   2. Fetch all transactions + cash ledger entries for the date
 *   3. Validate: transaction totals match cash ledger totals
 *   4. Validate: cash reconciliation (transaction cash == ledger cash)
 *   5. Generate and persist the immutable daily snapshot
 *
 * Once closed, the DailyClose document blocks all mutations at the model layer.
 * Refunds processed after close reference the original sale date for linkage
 * but affect the current (open) day's totals — the closed snapshot never changes.
 *
 * All VAT figures come from stored transaction values — never recalculated.
 */

const DailyClose = require('../models/inv/DailyClose');
const Transaction = require('../models/inv/Transaction');
const CashLedger = require('../models/inv/CashLedger');
const Expense = require('../models/inv/Expense');
const { aggregateTransactions, queryDeviceProfitLoss } = require('./inv-query-service');
const { Device } = require('../models/inv/Device');
const { requireSystemActive } = require('../utils/inv-system-lock');

const R = v => Math.round(v * 100) / 100;

/**
 * Validate that the net transaction total matches the net cash ledger total
 * for sale/refund entries on the given date.
 */
async function validateTransactionLedgerMatch(dateStr) {
  const start = new Date(dateStr + 'T00:00:00.000Z');
  const end = new Date(dateStr + 'T23:59:59.999Z');

  // Transaction total
  const txns = await Transaction.find({ createdAt: { $gte: start, $lte: end } }).lean();
  let txnTotal = 0;
  let cashFromTxns = 0;
  for (const txn of txns) {
    txnTotal += txn.totalAmount || 0;
    if (txn.paymentMethod === 'cash') {
      cashFromTxns += txn.totalAmount || 0;
    } else if (txn.paymentMethod === 'split') {
      const cashPortion = (txn.totalAmount || 0) - (txn.cardAmount || 0);
      cashFromTxns += cashPortion;
    }
  }
  txnTotal = R(txnTotal);
  cashFromTxns = R(cashFromTxns);

  // Cash ledger total (sale entries in, refund entries out)
  const ledgerEntries = await CashLedger.find({
    createdAt: { $gte: start, $lte: end },
    entryType: { $in: ['sale', 'refund'] },
  }).lean();

  let ledgerNet = 0;
  let cashFromLedger = 0;
  for (const entry of ledgerEntries) {
    if (entry.direction === 'in') {
      ledgerNet += entry.amount || 0;
      if (entry.paymentMethod === 'cash' || entry.paymentMethod === 'split') {
        const cashPortion = (entry.cashReceived != null ? entry.cashReceived : entry.amount || 0)
                          - (entry.changeGiven || 0);
        cashFromLedger += cashPortion;
      }
    } else {
      ledgerNet -= entry.amount || 0;
      if (entry.paymentMethod === 'cash') {
        cashFromLedger -= entry.amount || 0;
      }
    }
  }
  ledgerNet = R(ledgerNet);
  cashFromLedger = R(cashFromLedger);

  const diff = R(Math.abs(txnTotal - ledgerNet));

  return {
    transactionLedgerMatch: diff <= 0.02,
    transactionTotal: txnTotal,
    ledgerTotal: ledgerNet,
    difference: diff,
    cashReconciliation: Math.abs(cashFromTxns - cashFromLedger) <= 0.02,
    cashFromTxns,
    cashFromLedger,
  };
}

/**
 * Execute daily close for the given date.
 *
 * @param {string} dateStr — YYYY-MM-DD format
 * @param {string} closedBy — User ID of the operator closing the day
 * @param {Object} [options]
 * @param {boolean} [options.skipDevicePL] — Skip device P&L query if unavailable
 * @returns {Promise<Object>} { snapshot, validation }
 */
async function closeDay(dateStr, closedBy, options = {}) {
  // ── 0. System safety check ─────────────────────────────────────
  await requireSystemActive();

  // ── 1. Verify not already closed ───────────────────────────────
  const existing = await DailyClose.findOne({ date: dateStr });
  if (existing && existing.status === 'closed') {
    throw Object.assign(
      new Error(`Day ${dateStr} is already closed`),
      { code: 'ALREADY_CLOSED' },
    );
  }
  // Allow re-generating a pending snapshot (it will be overwritten below)

  const start = new Date(dateStr + 'T00:00:00.000Z');
  const end = new Date(dateStr + 'T23:59:59.999Z');

  // ── 2. Fetch data for the day ─────────────────────────────────
  const transactions = await Transaction.find({
    createdAt: { $gte: start, $lte: end },
  }).sort({ createdAt: -1 }).lean();

  const expenses = await Expense.find({
    date: { $gte: start, $lte: end },
  }).lean();

  // ── 3. Aggregate (from stored values only — never recalculates) ─
  const agg = aggregateTransactions(transactions);

  // ── 4. Device P&L for the day ─────────────────────────────────
  let devicePL = null;
  if (!options.skipDevicePL) {
    try {
      devicePL = await queryDeviceProfitLoss({
        startDate: start.toISOString(),
        endDate: end.toISOString(),
      });
    } catch (_) {
      // Non-critical — device model may not always be available
    }
  }

  // ── 5. Expense totals ─────────────────────────────────────────
  let expenseTotal = 0;
  let expenseCash = 0;
  let expenseCard = 0;
  for (const e of expenses) {
    expenseTotal += e.amount || 0;
    if (e.paymentMethod === 'cash') expenseCash += e.amount || 0;
    else expenseCard += e.amount || 0;
  }

  // ── 6. Validate ───────────────────────────────────────────────
  const validation = await validateTransactionLedgerMatch(dateStr);

  const netCash = R(agg.payment.cash - expenseCash);

  // ── 7. Persist snapshot ──────────────────────────────────────
  const snapshotData = {
    date: dateStr,
    status: 'pending',
    closedBy,
    closedAt: new Date(),

    transactionCount: agg.summary.transactionCount,
    grossSales: agg.summary.grossSales,
    refundTotal: agg.summary.refundTotal,
    refundCount: agg.summary.refundCount,
    netSales: agg.summary.netSales,

    cashTotal: agg.payment.cash,
    cardTotal: agg.payment.card,
    splitCardTotal: agg.payment.split.card,
    splitCashTotal: agg.payment.split.cash,

    standard23Sales: agg.vat.standard23.sales,
    standard23Vat: agg.vat.standard23.vat,
    reduced135Sales: agg.vat.reduced135.sales,
    reduced135Vat: agg.vat.reduced135.vat,
    marginSales: agg.vat.margin.sales,
    marginVat: agg.vat.margin.vat,
    totalVat: agg.vat.totalVat,
    marginItems: agg.vat.margin.items || [],

    deviceProfitLoss: devicePL || { totalBuyPrice: 0, totalSellPrice: 0, grossProfit: 0, count: 0, soldCount: 0 },

    expenseTotal: R(expenseTotal),
    expenseCash: R(expenseCash),
    expenseCard: R(expenseCard),
    netCash,

    validation,
  };

  if (existing) {
    // Transition from 'open' → 'closed'
    Object.assign(existing, snapshotData);
    await existing.save();
    return { snapshot: existing.toObject(), validation };
  }

  const doc = await DailyClose.create(snapshotData);
  return { snapshot: doc.toObject(), validation };
}

/**
 * Confirm a pending daily close — transitions from 'pending' to 'closed'.
 * Once confirmed, the snapshot is IMMUTABLE and becomes the financial truth.
 *
 * @param {string} dateStr — YYYY-MM-DD
 * @param {string} confirmedBy — User ID of the root confirming
 * @returns {Promise<Object>} { snapshot, validation }
 */
async function confirmDay(dateStr, confirmedBy) {
  const doc = await DailyClose.findOne({ date: dateStr });
  if (!doc) {
    throw Object.assign(new Error(`Day ${dateStr} has no daily close record`), { code: 'NOT_FOUND' });
  }
  if (doc.status !== 'pending') {
    throw Object.assign(
      new Error(`Day ${dateStr} status is "${doc.status}", only 'pending' can be confirmed`),
      { code: 'INVALID_STATUS' },
    );
  }

  // Re-validate before confirming
  const validation = await validateTransactionLedgerMatch(dateStr);
  doc.status = 'closed';
  doc.closedBy = confirmedBy;
  doc.closedAt = new Date();
  doc.validation = validation;
  await doc.save();

  return { snapshot: doc.toObject(), validation };
}

/**
 * Get the close status for a given date.
 *
 * @param {string} dateStr — YYYY-MM-DD
 * @returns {Promise<{status: string, snapshot?: Object}>}
 */
async function getDayStatus(dateStr) {
  const doc = await DailyClose.findOne({ date: dateStr }).lean();
  if (!doc) return { status: 'open', date: dateStr };
  return {
    status: doc.status,
    date: doc.date,
    closedBy: doc.closedBy,
    closedAt: doc.closedAt,
    snapshot: doc.status === 'closed' || doc.status === 'pending' ? doc : undefined,
  };
}

/**
 * List all closed days within an optional date range.
 */
async function listClosedDays(startDate, endDate) {
  const match = { status: 'closed' };
  if (startDate || endDate) {
    match.date = {};
    if (startDate) match.date.$gte = startDate;
    if (endDate) match.date.$lte = endDate;
  }
  return DailyClose.find(match)
    .sort({ date: -1 })
    .select('-marginItems')
    .lean();
}

module.exports = {
  closeDay,
  confirmDay,
  getDayStatus,
  listClosedDays,
  validateTransactionLedgerMatch,
};
