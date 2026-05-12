const express = require('express');
const router = express.Router();
const Expense = require('../../models/inv/Expense');
const { jwtAuth, requireRole } = require('../../middleware/inv-auth');

// All routes require admin
router.use(jwtAuth, requireRole('root', 'manager', 'staff'));

// ─── POST /api/inv/expenses ─────────────────────────────────────────────────
router.post('/', async (req, res) => {
  try {
    const { category, description, amount, paymentMethod, date } = req.body;

    if (!category || !amount || amount <= 0) {
      return res.status(400).json({ error: '请填写支出分类和金额', code: 'VALIDATION_ERROR' });
    }

    const expense = await Expense.create({
      category: category.trim(),
      description: (description || '').trim(),
      amount,
      paymentMethod: paymentMethod || 'cash',
      operator: req.user.userId,
      date: date ? new Date(date) : new Date()
    });

    res.status(201).json(expense);
  } catch (err) {
    res.status(500).json({ error: '服务器错误' });
  }
});

// ─── GET /api/inv/expenses ──────────────────────────────────────────────────
router.get('/', async (req, res) => {
  try {
    const { startDate, endDate, category } = req.query;
    const filter = {};

    if (startDate || endDate) {
      filter.date = {};
      if (startDate) filter.date.$gte = new Date(startDate);
      if (endDate) {
        const end = new Date(endDate);
        end.setHours(23, 59, 59, 999);
        filter.date.$lte = end;
      }
    }
    if (category) filter.category = category;

    const expenses = await Expense.find(filter)
      .populate('operator', 'username displayName')
      .sort({ date: -1 });

    res.json({ data: expenses });
  } catch (err) {
    res.status(500).json({ error: '服务器错误' });
  }
});

// ─── GET /api/inv/expenses/summary ──────────────────────────────────────────
// Aggregate expenses by date range, grouped by category
router.get('/summary', async (req, res) => {
  try {
    const { startDate, endDate } = req.query;
    const filter = {};

    if (startDate || endDate) {
      filter.date = {};
      if (startDate) filter.date.$gte = new Date(startDate);
      if (endDate) {
        const end = new Date(endDate);
        end.setHours(23, 59, 59, 999);
        filter.date.$lte = end;
      }
    }

    const expenses = await Expense.find(filter).sort({ date: -1 });

    let totalCash = 0, totalCard = 0, totalTransfer = 0;
    const byCategory = {};
    const byDate = {};

    for (const e of expenses) {
      if (e.paymentMethod === 'cash') totalCash += e.amount;
      else if (e.paymentMethod === 'card') totalCard += e.amount;
      else totalTransfer += e.amount;

      if (!byCategory[e.category]) byCategory[e.category] = 0;
      byCategory[e.category] += e.amount;

      const dayKey = e.date.toISOString().split('T')[0];
      if (!byDate[dayKey]) byDate[dayKey] = 0;
      byDate[dayKey] += e.amount;
    }

    const r = v => Math.round(v * 100) / 100;

    res.json({
      data: {
        total: r(totalCash + totalCard + totalTransfer),
        cash: r(totalCash),
        card: r(totalCard),
        bankTransfer: r(totalTransfer),
        byCategory: Object.fromEntries(Object.entries(byCategory).map(([k, v]) => [k, r(v)])),
        byDate: Object.fromEntries(Object.entries(byDate).map(([k, v]) => [k, r(v)])),
        count: expenses.length
      }
    });
  } catch (err) {
    res.status(500).json({ error: '服务器错误' });
  }
});

// ─── DELETE /api/inv/expenses/:id ───────────────────────────────────────────
router.delete('/:id', async (req, res) => {
  try {
    const expense = await Expense.findByIdAndDelete(req.params.id);
    if (!expense) return res.status(404).json({ error: '支出记录不存在' });
    res.json({ message: '支出记录已删除' });
  } catch (err) {
    if (err.name === 'CastError') return res.status(404).json({ error: '支出记录不存在' });
    res.status(500).json({ error: '服务器错误' });
  }
});

module.exports = router;
