/**
 * DATA EXPORT API — ROOT only
 *
 * SYSTEM_SPEC §21 — Backup & Data Export Policy.
 * Provides manual export of core financial datasets.
 * No automatic backup. Admin responsibility for external retention.
 *
 * RUNBOOK §3 Rule E: Every ROOT action generates AuditLog.
 */

const express = require('express');
const mongoose = require('mongoose');
const router = express.Router();

const Transaction = require('../../models/inv/Transaction');
const CashLedger = require('../../models/inv/CashLedger');
const AuditLog = require('../../models/inv/AuditLog');
const DailyClose = require('../../models/inv/DailyClose');

const { jwtAuth, requireRole } = require('../../middleware/inv-auth');

// ─── All routes require ROOT authentication ─────────────────────────
router.use(jwtAuth, requireRole('root'));

// ─── Helper: build date filter ─────────────────────────────────────
function dateFilter(startDate, endDate) {
  const f = {};
  if (startDate) f.$gte = new Date(startDate + 'T00:00:00.000Z');
  if (endDate) f.$lte = new Date(endDate + 'T23:59:59.999Z');
  return Object.keys(f).length ? f : null;
}

// ─── Helper: flatten nested object to dot-notation ─────────────────
function flatten(obj, prefix = '', seen = new WeakSet()) {
  if (obj === null || obj === undefined) return {};
  if (typeof obj !== 'object') return { [prefix]: obj };
  if (seen.has(obj)) return { [prefix]: '[Circular]' };
  seen.add(obj);

  let result = {};
  for (const key of Object.keys(obj)) {
    const val = obj[key];
    const path = prefix ? prefix + '.' + key : key;

    if (val === null || val === undefined) {
      result[path] = '';
    } else if (typeof val === 'object' && !(val instanceof Date) && !Array.isArray(val)) {
      Object.assign(result, flatten(val, path, seen));
    } else if (Array.isArray(val)) {
      // Serialize arrays as JSON string
      result[path] = JSON.stringify(val);
    } else if (val instanceof Date) {
      result[path] = val.toISOString();
    } else if (typeof val === 'object' && val._id) {
      // MongoDB ObjectId or reference
      result[path] = val._id.toString();
    } else {
      result[path] = val;
    }
  }
  return result;
}

// ─── Helper: convert flat rows to CSV ──────────────────────────────
function toCsv(rows) {
  if (rows.length === 0) return '';

  // Collect all unique column names preserving order
  const columns = [];
  const seenCols = new Set();
  for (const row of rows) {
    for (const key of Object.keys(row)) {
      if (!seenCols.has(key)) {
        seenCols.add(key);
        columns.push(key);
      }
    }
  }

  const escape = v => {
    if (v === null || v === undefined) return '""';
    const s = String(v);
    if (s.includes(',') || s.includes('"') || s.includes('\n')) {
      return '"' + s.replace(/"/g, '""') + '"';
    }
    return '"' + s + '"';
  };

  const lines = [];
  lines.push(columns.map(c => escape(c)).join(','));
  for (const row of rows) {
    lines.push(columns.map(c => escape(row[c])).join(','));
  }
  return lines.join('\n');
}

// ─── Helper: wrap response (JSON or CSV) ──────────────────────────
function respondExport(req, res, exportType, rows) {
  const format = (req.query.format || 'json').toLowerCase();

  // Strip internal fields from every row
  const clean = rows.map(r => {
    if (r && typeof r === 'object') {
      const { __v, _permissions, ...rest } = r;
      return rest;
    }
    return r;
  });

  if (format === 'csv') {
    const flat = clean.map(r => flatten(r));
    const csv = toCsv(flat);
    const filename = exportType + '-' + new Date().toISOString().split('T')[0] + '.csv';
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', 'attachment; filename="' + filename + '"');
    return res.send(csv);
  }

  // Default: JSON
  res.json({
    exportType,
    exportedAt: new Date().toISOString(),
    count: clean.length,
    data: clean,
  });
}

// ═══════════════════════════════════════════════════════════════════
// EXPORT ENDPOINTS
// ═══════════════════════════════════════════════════════════════════

// ─── GET /api/inv/export/transactions ───────────────────────────────
router.get('/transactions', async (req, res) => {
  try {
    const { startDate, endDate } = req.query;
    const filter = {};
    const df = dateFilter(startDate, endDate);
    if (df) filter.createdAt = df;

    const data = await Transaction.find(filter)
      .sort({ createdAt: -1 })
      .populate('operator', 'username displayName role')
      .lean();

    respondExport(req, res, 'transactions', data);
  } catch (err) {
    console.error('Export transactions error:', err.message);
    res.status(500).json({ error: 'Export failed', code: 'EXPORT_ERROR' });
  }
});

// ─── GET /api/inv/export/cash-ledger ────────────────────────────────
router.get('/cash-ledger', async (req, res) => {
  try {
    const { startDate, endDate } = req.query;
    const filter = {};
    const df = dateFilter(startDate, endDate);
    if (df) filter.createdAt = df;

    const data = await CashLedger.find(filter)
      .sort({ createdAt: -1 })
      .populate('operator', 'username displayName role')
      .lean();

    respondExport(req, res, 'cash-ledger', data);
  } catch (err) {
    console.error('Export cash-ledger error:', err.message);
    res.status(500).json({ error: 'Export failed', code: 'EXPORT_ERROR' });
  }
});

// ─── GET /api/inv/export/audit-log ──────────────────────────────────
router.get('/audit-log', async (req, res) => {
  try {
    const { startDate, endDate } = req.query;
    const filter = {};
    const df = dateFilter(startDate, endDate);
    if (df) filter.createdAt = df;

    const data = await AuditLog.find(filter)
      .sort({ createdAt: -1 })
      .populate('operator', 'username displayName role')
      .lean();

    respondExport(req, res, 'audit-log', data);
  } catch (err) {
    console.error('Export audit-log error:', err.message);
    res.status(500).json({ error: 'Export failed', code: 'EXPORT_ERROR' });
  }
});

// ─── GET /api/inv/export/daily-close ────────────────────────────────
router.get('/daily-close', async (req, res) => {
  try {
    const { startDate, endDate } = req.query;
    const filter = {};
    const df = dateFilter(startDate, endDate);
    if (df) filter.date = {};
    if (startDate) filter.date.$gte = startDate;
    if (endDate) filter.date.$lte = endDate;

    const data = await DailyClose.find(filter)
      .sort({ date: -1 })
      .lean();

    respondExport(req, res, 'daily-close', data);
  } catch (err) {
    console.error('Export daily-close error:', err.message);
    res.status(500).json({ error: 'Export failed', code: 'EXPORT_ERROR' });
  }
});

module.exports = router;
