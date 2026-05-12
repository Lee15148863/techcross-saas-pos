/**
 * ROOT CSV EXPORT API — Financial-grade CSV download endpoints
 *
 * SYSTEM_SPEC §21 — Backup & Data Export Policy
 * RUNBOOK §3 Rule A — No frontend logic
 * RUNBOOK §3 Rule E — Every ROOT action generates AuditLog
 *
 * Read-only financial export layer. No data modification.
 * All values come directly from stored DB fields — no recalculation.
 */

const express = require('express');
const mongoose = require('mongoose');
const { encryptData: _encryptData } = require('../../utils/inv-crypto');
const router = express.Router();

const Transaction = require('../../models/inv/Transaction');
const CashLedger = require('../../models/inv/CashLedger');
const AuditLog = require('../../models/inv/AuditLog');
const DailyClose = require('../../models/inv/DailyClose');

const { jwtAuth, requireRole } = require('../../middleware/inv-auth');

// ─── All routes require ROOT authentication ─────────────────────────
router.use(jwtAuth, requireRole('root'));

function encryptData(data) {
  return _encryptData(data, false);
}

// ─── Helper: build date filter ──────────────────────────────────────
function dateFilter(startDate, endDate) {
  const f = {};
  if (startDate) f.$gte = new Date(startDate + 'T00:00:00.000Z');
  if (endDate) f.$lte = new Date(endDate + 'T23:59:59.999Z');
  return Object.keys(f).length ? f : null;
}

// ─── Helper: format date for CSV (ISO 8601 without Z) ─────────────
function fmtDate(d) {
  if (!d) return '';
  const dt = d instanceof Date ? d : new Date(d);
  if (isNaN(dt.getTime())) return '';
  return dt.toISOString().replace('T', ' ').replace(/\.\d+Z$/, '');
}

// ─── Helper: format currency to 2 decimal places ────────────────────
function fmtCurrency(v) {
  if (v === null || v === undefined || isNaN(v)) return '0.00';
  return (Math.round(v * 100) / 100).toFixed(2);
}

// ─── Helper: CSV escape ─────────────────────────────────────────────
function esc(v) {
  if (v === null || v === undefined) return '';
  const s = String(v);
  if (s.includes(',') || s.includes('"') || s.includes('\n') || s.includes('\r')) {
    return '"' + s.replace(/"/g, '""') + '"';
  }
  return s;
}

// ─── Helper: CSV write header + data rows via cursor stream ────────
// Pre-defined columns ensure Excel-compatible fixed structure.
// Using MongoDB cursor streaming for 10k+ row performance.

// ─── CSV column definitions ─────────────────────────────────────────
const TXN_COLUMNS = [
  'ReceiptNumber', 'Type', 'PaymentMethod',
  'TotalAmount', 'CashReceived', 'CardAmount', 'ChangeGiven',
  'StandardVatTotal', 'MarginVatTotal', 'SubtotalBeforeOrderDiscount',
  'ItemsCount', 'ItemsDetail',
  'OperatorName', 'OperatorRole',
  'OriginalReceipt', 'CreatedAt',
];

const LEDGER_COLUMNS = [
  'EntryType', 'Direction',
  'Amount', 'PaymentMethod',
  'CashReceived', 'CardAmount', 'ChangeGiven',
  'ReferenceType', 'ReferenceId', 'ReceiptNumber',
  'Description',
  'OperatorName',
  'CreatedAt',
];

const AUDIT_COLUMNS = [
  'Action', 'OperatorName', 'Role', 'Module',
  'TargetType', 'TargetId', 'Ip',
  'CreatedAt',
];

const DAILY_CLOSE_COLUMNS = [
  'Date', 'Status', 'ClosedBy',
  'GrossSales', 'RefundTotal', 'RefundCount', 'NetSales',
  'CashTotal', 'CardTotal', 'SplitCardTotal', 'SplitCashTotal',
  'Standard23Sales', 'Standard23Vat',
  'Reduced135Sales', 'Reduced135Vat',
  'MarginSales', 'MarginVat',
  'TotalVat',
  'DeviceBuyTotal', 'DeviceSellTotal', 'DeviceGrossProfit',
  'DeviceCount', 'DeviceSoldCount',
  'ExpenseTotal', 'ExpenseCash', 'ExpenseCard',
  'NetCash',
  'ValidationTransactionMatch', 'ValidationCashReconciliation',
  'CreatedAt',
];

// ─── Helper: write CSV header ───────────────────────────────────────
function writeHeader(res, columns) {
  res.write('﻿'); // BOM for Excel UTF-8
  res.write(columns.map(c => esc(c)).join(',') + '\n');
}

// ─── Helper: extract txn data row ──────────────────────────────────
function txnRow(t) {
  const type = t.totalAmount < 0 ? 'REFUND' : (t.originalReceipt ? 'REVERSAL' : 'SALE');
  const operatorName = t.operator?.displayName || t.operator?.username || '';
  const operatorRole = t.operator?.role || '';
  const itemsCount = t.items ? t.items.length : 0;
  return [
    t.receiptNumber || '', type, t.paymentMethod || '',
    fmtCurrency(t.totalAmount), fmtCurrency(t.cashReceived), fmtCurrency(t.cardAmount), fmtCurrency(t.changeGiven),
    fmtCurrency(t.standardVatTotal), fmtCurrency(t.marginVatTotal), fmtCurrency(t.subtotalBeforeOrderDiscount),
    itemsCount, esc(JSON.stringify(t.items || [])),
    esc(operatorName), esc(operatorRole),
    t.originalReceipt || '', fmtDate(t.createdAt),
  ];
}

// ─── Helper: extract ledger data row ───────────────────────────────
function ledgerRow(l) {
  const operatorName = l.operator?.displayName || l.operator?.username || '';
  return [
    l.entryType || '', l.direction || '',
    fmtCurrency(l.amount), l.paymentMethod || '',
    fmtCurrency(l.cashReceived), fmtCurrency(l.cardAmount), fmtCurrency(l.changeGiven),
    l.referenceType || '', l.referenceId ? l.referenceId.toString() : '', l.receiptNumber || '',
    esc(l.description || ''),
    esc(operatorName),
    fmtDate(l.createdAt),
  ];
}

// ─── Helper: extract audit data row ────────────────────────────────
function auditRow(a) {
  const operatorName = a.operator?.displayName || a.operator?.username || '';
  return [
    a.action || '', esc(operatorName), a.role || 'root', a.module || '',
    a.targetType || '', a.targetId || '', a.ip || '',
    fmtDate(a.createdAt),
  ];
}

// ─── Helper: extract daily close data row ──────────────────────────
function dailyCloseRow(d) {
  const devPL = d.deviceProfitLoss || {};
  const val = d.validation || {};
  return [
    d.date || '', d.status || '', d.closedBy || '',
    fmtCurrency(d.grossSales), fmtCurrency(d.refundTotal), d.refundCount || 0, fmtCurrency(d.netSales),
    fmtCurrency(d.cashTotal), fmtCurrency(d.cardTotal), fmtCurrency(d.splitCardTotal), fmtCurrency(d.splitCashTotal),
    fmtCurrency(d.standard23Sales), fmtCurrency(d.standard23Vat),
    fmtCurrency(d.reduced135Sales), fmtCurrency(d.reduced135Vat),
    fmtCurrency(d.marginSales), fmtCurrency(d.marginVat),
    fmtCurrency(d.totalVat),
    fmtCurrency(devPL.totalBuyPrice), fmtCurrency(devPL.totalSellPrice), fmtCurrency(devPL.grossProfit),
    devPL.count || 0, devPL.soldCount || 0,
    fmtCurrency(d.expenseTotal), fmtCurrency(d.expenseCash), fmtCurrency(d.expenseCard),
    fmtCurrency(d.netCash),
    val.transactionLedgerMatch !== undefined ? (val.transactionLedgerMatch ? 'PASS' : 'FAIL') : '',
    val.cashReconciliation !== undefined ? (val.cashReconciliation ? 'PASS' : 'FAIL') : '',
    fmtDate(d.createdAt),
  ];
}

// ═══════════════════════════════════════════════════════════════════
// CSV EXPORT ENDPOINTS
// ═══════════════════════════════════════════════════════════════════

// ─── GET /api/root/export/csv/transactions ──────────────────────────
router.get('/csv/transactions', async (req, res) => {
  const startTime = Date.now();
  try {
    const { startDate, endDate } = req.query;
    const filter = {};
    const df = dateFilter(startDate, endDate);
    if (df) filter.createdAt = df;

    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', 'attachment; filename="transactions.csv"');
    res.setHeader('Cache-Control', 'no-cache');

    writeHeader(res, TXN_COLUMNS);

    const cursor = Transaction.find(filter)
      .sort({ createdAt: -1 })
      .populate('operator', 'username displayName role')
      .lean()
      .cursor();

    let rowCount = 0;
    for await (const doc of cursor) {
      res.write(txnRow(doc).map(v => esc(v)).join(',') + '\n');
      rowCount++;
    }

    res.end();
    console.log(`Export CSV transactions: ${rowCount} rows in ${Date.now() - startTime}ms`);

    // Audit log (async, non-blocking)
    AuditLog.create({
      action: 'EXPORT_CSV',
      operator: 'root',
      role: 'root',
      module: 'export',
      targetType: 'transactions',
      targetId: 'csv_export',
      encryptedData: encryptData({
        dataset: 'transactions',
        rowCount,
        startDate: startDate || null,
        endDate: endDate || null,
        elapsed: Date.now() - startTime,
      }),
      ip: req.ip,
    }).catch(err => console.error('Export audit log failed:', err.message));

  } catch (err) {
    console.error('Export CSV transactions error:', err.message);
    // If headers already sent, try ending; otherwise send error
    if (res.headersSent) return res.end();
    res.status(500).json({ error: 'Export failed', code: 'EXPORT_ERROR' });
  }
});

// ─── GET /api/root/export/csv/ledger ────────────────────────────────
router.get('/csv/ledger', async (req, res) => {
  const startTime = Date.now();
  try {
    const { startDate, endDate } = req.query;
    const filter = {};
    const df = dateFilter(startDate, endDate);
    if (df) filter.createdAt = df;

    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', 'attachment; filename="ledger.csv"');
    res.setHeader('Cache-Control', 'no-cache');

    writeHeader(res, LEDGER_COLUMNS);

    const cursor = CashLedger.find(filter)
      .sort({ createdAt: -1 })
      .populate('operator', 'username displayName role')
      .lean()
      .cursor();

    let rowCount = 0;
    for await (const doc of cursor) {
      res.write(ledgerRow(doc).map(v => esc(v)).join(',') + '\n');
      rowCount++;
    }

    res.end();
    console.log(`Export CSV ledger: ${rowCount} rows in ${Date.now() - startTime}ms`);

    AuditLog.create({
      action: 'EXPORT_CSV',
      operator: 'root',
      role: 'root',
      module: 'export',
      targetType: 'cash-ledger',
      targetId: 'csv_export',
      encryptedData: encryptData({
        dataset: 'cash-ledger',
        rowCount,
        startDate: startDate || null,
        endDate: endDate || null,
        elapsed: Date.now() - startTime,
      }),
      ip: req.ip,
    }).catch(err => console.error('Export audit log failed:', err.message));

  } catch (err) {
    console.error('Export CSV ledger error:', err.message);
    if (res.headersSent) return res.end();
    res.status(500).json({ error: 'Export failed', code: 'EXPORT_ERROR' });
  }
});

// ─── GET /api/root/export/csv/audit ─────────────────────────────────
router.get('/csv/audit', async (req, res) => {
  const startTime = Date.now();
  try {
    const { startDate, endDate } = req.query;
    const filter = {};
    const df = dateFilter(startDate, endDate);
    if (df) filter.createdAt = df;

    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', 'attachment; filename="audit.csv"');
    res.setHeader('Cache-Control', 'no-cache');

    writeHeader(res, AUDIT_COLUMNS);

    const cursor = AuditLog.find(filter)
      .sort({ createdAt: -1 })
      .populate('operator', 'username displayName role')
      .lean()
      .cursor();

    let rowCount = 0;
    for await (const doc of cursor) {
      res.write(auditRow(doc).map(v => esc(v)).join(',') + '\n');
      rowCount++;
    }

    res.end();
    console.log(`Export CSV audit: ${rowCount} rows in ${Date.now() - startTime}ms`);

    AuditLog.create({
      action: 'EXPORT_CSV',
      operator: 'root',
      role: 'root',
      module: 'export',
      targetType: 'audit-log',
      targetId: 'csv_export',
      encryptedData: encryptData({
        dataset: 'audit-log',
        rowCount,
        startDate: startDate || null,
        endDate: endDate || null,
        elapsed: Date.now() - startTime,
      }),
      ip: req.ip,
    }).catch(err => console.error('Export audit log failed:', err.message));

  } catch (err) {
    console.error('Export CSV audit error:', err.message);
    if (res.headersSent) return res.end();
    res.status(500).json({ error: 'Export failed', code: 'EXPORT_ERROR' });
  }
});

// ─── GET /api/root/export/csv/daily-close ───────────────────────────
router.get('/csv/daily-close', async (req, res) => {
  const startTime = Date.now();
  try {
    const { startDate, endDate } = req.query;
    const filter = {};
    if (startDate || endDate) {
      filter.date = {};
      if (startDate) filter.date.$gte = startDate;
      if (endDate) filter.date.$lte = endDate;
    }

    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', 'attachment; filename="daily_close.csv"');
    res.setHeader('Cache-Control', 'no-cache');

    writeHeader(res, DAILY_CLOSE_COLUMNS);

    const cursor = DailyClose.find(filter)
      .sort({ date: -1 })
      .lean()
      .cursor();

    let rowCount = 0;
    for await (const doc of cursor) {
      res.write(dailyCloseRow(doc).map(v => esc(v)).join(',') + '\n');
      rowCount++;
    }

    res.end();
    console.log(`Export CSV daily-close: ${rowCount} rows in ${Date.now() - startTime}ms`);

    AuditLog.create({
      action: 'EXPORT_CSV',
      operator: 'root',
      role: 'root',
      module: 'export',
      targetType: 'daily-close',
      targetId: 'csv_export',
      encryptedData: encryptData({
        dataset: 'daily-close',
        rowCount,
        startDate: startDate || null,
        endDate: endDate || null,
        elapsed: Date.now() - startTime,
      }),
      ip: req.ip,
    }).catch(err => console.error('Export audit log failed:', err.message));

  } catch (err) {
    console.error('Export CSV daily-close error:', err.message);
    if (res.headersSent) return res.end();
    res.status(500).json({ error: 'Export failed', code: 'EXPORT_ERROR' });
  }
});

// ═══════════════════════════════════════════════════════════════════
// VAT SUMMARY EXPORT
// ═══════════════════════════════════════════════════════════════════

const VAT_COLUMNS = [
  'period_start', 'period_end',
  'total_sales', 'standard_vat_23', 'reduced_vat_13_5', 'margin_vat',
  'output_vat_total',
  'refunds_total', 'net_sales',
  'cash_total', 'card_total', 'bank_total',
];

// ─── GET /api/root/export/csv/vat-summary ───────────────────────────
// Tax preparation report: daily VAT breakdown within a date range.
// All values from stored transaction fields only — no recalculation.
router.get('/csv/vat-summary', async (req, res) => {
  const startTime = Date.now();
  try {
    const { startDate, endDate } = req.query;
    const filter = {};
    const df = dateFilter(startDate, endDate);
    if (df) filter.createdAt = df;

    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', 'attachment; filename="vat_summary.csv"');
    res.setHeader('Cache-Control', 'no-cache');

    writeHeader(res, VAT_COLUMNS);

    const cursor = Transaction.find(filter)
      .sort({ createdAt: 1 }) // chronological order
      .lean()
      .cursor();

    // Accumulate daily totals from stored values only
    const daily = new Map();

    for await (const txn of cursor) {
      const day = fmtDate(txn.createdAt).split(' ')[0];
      if (!daily.has(day)) {
        daily.set(day, {
          total_sales: 0, standard_vat_23: 0, reduced_vat_13_5: 0,
          margin_vat: 0, refunds_total: 0,
          cash_total: 0, card_total: 0,
        });
      }
      const d = daily.get(day);

      // Item-level VAT breakdown by rate (stored values only)
      let std23 = 0, std135 = 0, margin = 0;
      if (txn.items && Array.isArray(txn.items)) {
        for (const item of txn.items) {
          if (item.marginVat) {
            margin += item.marginVat;
          } else {
            const vat = item.vatAmount || 0;
            const rate = item.vatRate || 0.23;
            if (Math.abs(rate - 0.135) < 0.001) {
              std135 += vat;
            } else {
              std23 += vat;
            }
          }
        }
      }

      d.standard_vat_23 += std23;
      d.reduced_vat_13_5 += std135;
      d.margin_vat += margin;

      // Transaction-level totals
      const amt = txn.totalAmount || 0;
      if (amt < 0) {
        d.refunds_total += Math.abs(amt);
      } else {
        d.total_sales += amt;
      }

      // Payment breakdown
      if (txn.paymentMethod === 'cash') {
        d.cash_total += amt;
      } else if (txn.paymentMethod === 'card') {
        d.card_total += amt;
      } else if (txn.paymentMethod === 'split') {
        const cardPortion = txn.cardAmount || 0;
        d.card_total += cardPortion;
        // If total is negative (refund via split), cash portion is negative too
        d.cash_total += amt - cardPortion;
      }
    }

    // Write one row per day
    const sortedDays = [...daily.keys()].sort();
    for (const day of sortedDays) {
      const d = daily.get(day);
      const netSales = d.total_sales - d.refunds_total;
      const outputVat = d.standard_vat_23 + d.reduced_vat_13_5 + d.margin_vat;
      const row = [
        day, day,
        fmtCurrency(d.total_sales),
        fmtCurrency(d.standard_vat_23), fmtCurrency(d.reduced_vat_13_5), fmtCurrency(d.margin_vat),
        fmtCurrency(outputVat),
        fmtCurrency(d.refunds_total), fmtCurrency(netSales),
        fmtCurrency(d.cash_total), fmtCurrency(d.card_total), '0.00',
      ];
      res.write(row.join(',') + '\n');
    }

    res.end();
    console.log(`Export CSV vat-summary: ${sortedDays.length} days in ${Date.now() - startTime}ms`);

    AuditLog.create({
      action: 'EXPORT_VAT_SUMMARY',
      operator: 'root',
      role: 'root',
      module: 'export',
      targetType: 'vat-summary',
      targetId: 'csv_export',
      encryptedData: encryptData({
        dataset: 'vat-summary',
        dayCount: sortedDays.length,
        startDate: startDate || null,
        endDate: endDate || null,
        elapsed: Date.now() - startTime,
      }),
      ip: req.ip,
    }).catch(err => console.error('Export audit log failed:', err.message));

  } catch (err) {
    console.error('Export CSV vat-summary error:', err.message);
    if (res.headersSent) return res.end();
    res.status(500).json({ error: 'Export failed', code: 'EXPORT_ERROR' });
  }
});

module.exports = router;
