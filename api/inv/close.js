const express = require('express');
const router = express.Router();
const DailyClose = require('../../models/inv/DailyClose');
const { jwtAuth, requireRole } = require('../../middleware/inv-auth');

// All routes require Staff+ access
router.use(jwtAuth, requireRole('root', 'manager', 'staff'));

// ─── GET /api/inv/close/status?date=YYYY-MM-DD ──────────────────────
// Check whether a specific day is open or closed
router.get('/status', async (req, res) => {
  try {
    const { date } = req.query;
    if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      return res.status(400).json({ error: '日期格式无效，请使用 YYYY-MM-DD', code: 'VALIDATION_ERROR' });
    }

    const { getDayStatus } = require('../../services/inv-daily-close-service');
    const result = await getDayStatus(date);

    res.json(result);
  } catch (err) {
    console.error('Close status error:', err.message);
    res.status(500).json({ error: '服务器错误' });
  }
});

// ─── POST /api/inv/close ────────────────────────────────────────────
// Execute daily close for a given date
router.post('/', async (req, res) => {
  try {
    const { date, skipDevicePL } = req.body;

    if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      return res.status(400).json({ error: '日期格式无效，请使用 YYYY-MM-DD', code: 'VALIDATION_ERROR' });
    }

    const { closeDay } = require('../../services/inv-daily-close-service');
    const result = await closeDay(date, req.user.userId, { skipDevicePL: !!skipDevicePL });

    const statusCode = result.validation.transactionLedgerMatch && result.validation.cashReconciliation
      ? 200 : 409;

    res.status(statusCode).json({
      message: statusCode === 200 ? '日结成功（待确认）' : '日结完成但存在数据不匹配（待确认）',
      date,
      status: 'pending',
      snapshot: result.snapshot,
      validation: result.validation,
    });
  } catch (err) {
    switch (err.code) {
      case 'ALREADY_CLOSED':
        return res.status(409).json({ error: '该日期已经日结', code: err.code });
      default:
        console.error('Daily close error:', err.message);
        res.status(500).json({ error: '日结处理失败', code: 'CLOSE_ERROR' });
    }
  }
});

// ─── POST /api/inv/close/confirm ───────────────────────────────────
// Confirm a pending daily close (ROOT only).
// Transitions from 'pending' → 'closed'. Once confirmed, the snapshot
// is IMMUTABLE and Transactions for that day are locked.
router.post('/confirm', requireRole('root'), async (req, res) => {
  try {
    const { date } = req.body;

    if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      return res.status(400).json({ error: '日期格式无效，请使用 YYYY-MM-DD', code: 'VALIDATION_ERROR' });
    }

    const { confirmDay } = require('../../services/inv-daily-close-service');
    const result = await confirmDay(date, req.user.userId);

    res.json({
      message: `✅ ${date} 日结已确认`,
      date,
      status: 'closed',
      snapshot: result.snapshot,
      validation: result.validation,
    });
  } catch (err) {
    switch (err.code) {
      case 'NOT_FOUND':
        return res.status(404).json({ error: err.message, code: err.code });
      case 'INVALID_STATUS':
        return res.status(409).json({ error: err.message, code: err.code });
      default:
        console.error('Confirm close error:', err.message);
        res.status(500).json({ error: '确认日结失败', code: 'CONFIRM_ERROR' });
    }
  }
});

// ─── GET /api/inv/close/history ─────────────────────────────────────
// List all closed days
router.get('/history', async (req, res) => {
  try {
    const { startDate, endDate } = req.query;
    const { listClosedDays } = require('../../services/inv-daily-close-service');
    const days = await listClosedDays(startDate || undefined, endDate || undefined);

    res.json({ data: days, count: days.length });
  } catch (err) {
    console.error('Close history error:', err.message);
    res.status(500).json({ error: '服务器错误' });
  }
});

// ─── GET /api/inv/close/:date ───────────────────────────────────────
// Get the full snapshot for a specific closed day
router.get('/:date', async (req, res) => {
  try {
    const { date } = req.params;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      return res.status(400).json({ error: '日期格式无效', code: 'VALIDATION_ERROR' });
    }

    const doc = await DailyClose.findOne({ date }).lean();
    if (!doc) {
      return res.status(404).json({ error: '该日期无日结记录', code: 'NOT_FOUND' });
    }

    res.json(doc);
  } catch (err) {
    console.error('Close snapshot error:', err.message);
    res.status(500).json({ error: '服务器错误' });
  }
});

module.exports = router;
