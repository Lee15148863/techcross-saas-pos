const express = require('express');
const router = express.Router();
const PosShortcut = require('../../models/inv/PosShortcut');
const { jwtAuth, requireRole } = require('../../middleware/inv-auth');

// All routes require JWT authentication (Admin or Staff)
router.use(jwtAuth, requireRole('root', 'manager', 'staff'));

// ─── GET /api/inv/pos-shortcuts ─────────────────────────────────────────────
// 返回 1~20 号快捷按钮配置，始终返回 20 条记录
router.get('/', async (req, res) => {
  try {
    const records = await PosShortcut.find({}).sort({ sort_no: 1 }).lean();

    // 构建完整 1-20 数组，未配置的位置填充默认空值
    const result = [];
    for (let i = 1; i <= 20; i++) {
      const existing = records.find(r => r.sort_no === i);
      if (existing) {
        result.push(existing);
      } else {
        result.push({
          sort_no: i,
          title: '',
          product_id: null,
          price: 0,
          vat: 0.23,
          sku: '',
          status: false
        });
      }
    }

    res.json(result);
  } catch (err) {
    res.status(500).json({ error: '服务器错误' });
  }
});

// ─── PUT /api/inv/pos-shortcuts ─────────────────────────────────────────────
// 批量保存 20 个快捷按钮配置（仅 Admin）
router.put('/', requireRole('root'), async (req, res) => {
  try {
    const { shortcuts } = req.body;

    // 验证数组长度
    if (!Array.isArray(shortcuts) || shortcuts.length !== 20) {
      return res.status(400).json({ error: '必须提供 20 条快捷按钮配置' });
    }

    // 验证 sort_no 范围和唯一性
    const sortNos = new Set();
    for (const item of shortcuts) {
      const sn = item.sort_no;
      if (!Number.isInteger(sn) || sn < 1 || sn > 20) {
        return res.status(400).json({ error: 'sort_no 必须为 1-20 的整数' });
      }
      if (sortNos.has(sn)) {
        return res.status(400).json({ error: 'sort_no 不能重复' });
      }
      sortNos.add(sn);
    }

    // 使用 bulkWrite 批量 upsert
    const ops = shortcuts.map(item => ({
      updateOne: {
        filter: { sort_no: item.sort_no },
        update: {
          $set: {
            title: item.title || '',
            product_id: item.product_id || null,
            price: item.price || 0,
            vat: item.vat !== undefined ? item.vat : 0.23,
            sku: item.sku || '',
            status: !!item.product_id,
            updatedAt: new Date()
          }
        },
        upsert: true
      }
    }));

    await PosShortcut.bulkWrite(ops);

    // 返回保存后的完整数据
    const saved = await PosShortcut.find({}).sort({ sort_no: 1 }).lean();
    const result = [];
    for (let i = 1; i <= 20; i++) {
      const existing = saved.find(r => r.sort_no === i);
      if (existing) {
        result.push(existing);
      } else {
        result.push({ sort_no: i, title: '', product_id: null, price: 0, vat: 0.23, sku: '', status: false });
      }
    }

    res.json(result);
  } catch (err) {
    if (err.name === 'ValidationError') {
      const messages = Object.values(err.errors).map(e => e.message);
      return res.status(400).json({ error: messages.join('；') });
    }
    res.status(500).json({ error: '服务器错误' });
  }
});

module.exports = router;
