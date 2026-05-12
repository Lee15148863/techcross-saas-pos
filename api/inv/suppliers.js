const express = require('express');
const router = express.Router();
const Supplier = require('../../models/inv/Supplier');
const PurchaseOrder = require('../../models/inv/PurchaseOrder');
const { jwtAuth, requireRole } = require('../../middleware/inv-auth');

// All routes require Staff+ access
router.use(jwtAuth, requireRole('root', 'manager', 'staff'));

// ─── PUT /api/inv/suppliers/batch-disable ───────────────────────────────────
// Batch disable suppliers (Admin only)
// Must be defined BEFORE /:id routes to avoid route conflict
router.put('/batch-disable', requireRole('root'), async (req, res) => {
  try {
    const { ids, reason } = req.body;

    if (!ids || !Array.isArray(ids) || ids.length === 0) {
      return res.status(400).json({ error: '缺少必填字段：ids', code: 'VALIDATION_ERROR' });
    }

    const now = new Date();
    const result = await Supplier.updateMany(
      { _id: { $in: ids }, active: true },
      {
        active: false,
        disableReason: reason || undefined,
        disabledAt: now,
        updatedAt: now
      }
    );

    res.json({
      modifiedCount: result.modifiedCount,
      message: `已禁用 ${result.modifiedCount} 个供应商`
    });
  } catch (err) {
    res.status(500).json({ error: '服务器错误' });
  }
});

// ─── PUT /api/inv/suppliers/batch-enable ────────────────────────────────────
// Batch enable suppliers (Admin only)
// Must be defined BEFORE /:id routes to avoid route conflict
router.put('/batch-enable', requireRole('root'), async (req, res) => {
  try {
    const { ids } = req.body;

    if (!ids || !Array.isArray(ids) || ids.length === 0) {
      return res.status(400).json({ error: '缺少必填字段：ids', code: 'VALIDATION_ERROR' });
    }

    const now = new Date();
    const result = await Supplier.updateMany(
      { _id: { $in: ids }, active: false },
      {
        active: true,
        $unset: { disableReason: '', disabledAt: '' },
        updatedAt: now
      }
    );

    res.json({
      modifiedCount: result.modifiedCount,
      message: `已恢复 ${result.modifiedCount} 个供应商`
    });
  } catch (err) {
    res.status(500).json({ error: '服务器错误' });
  }
});

// ─── GET /api/inv/suppliers ─────────────────────────────────────────────────
// Supplier list, default hide disabled (active=true), support ?showDisabled=true
router.get('/', async (req, res) => {
  try {
    const filter = {};

    // By default hide disabled suppliers unless showDisabled=true
    if (req.query.showDisabled !== 'true') {
      filter.active = true;
    }

    const suppliers = await Supplier.find(filter).sort({ updatedAt: -1 });
    res.json(suppliers);
  } catch (err) {
    res.status(500).json({ error: '服务器错误' });
  }
});

// ─── GET /api/inv/suppliers/:id ─────────────────────────────────────────────
// Supplier detail
router.get('/:id', async (req, res) => {
  try {
    const supplier = await Supplier.findById(req.params.id);
    if (!supplier) {
      return res.status(404).json({ error: '供应商不存在' });
    }
    res.json(supplier);
  } catch (err) {
    if (err.name === 'CastError') {
      return res.status(404).json({ error: '供应商不存在' });
    }
    res.status(500).json({ error: '服务器错误' });
  }
});

// ─── POST /api/inv/suppliers ────────────────────────────────────────────────
// Create supplier (validate name required)
router.post('/', async (req, res) => {
  try {
    const { name, contactName, phone, email, address, level, note } = req.body;

    // Name is required
    if (!name || (typeof name === 'string' && name.trim() === '')) {
      return res.status(400).json({
        error: '缺少必填字段：name',
        code: 'VALIDATION_ERROR'
      });
    }

    const supplierData = {
      name: name.trim(),
      active: true
    };

    if (contactName) supplierData.contactName = contactName.trim();
    if (phone) supplierData.phone = phone.trim();
    if (email) supplierData.email = email.trim();
    if (address) supplierData.address = address.trim();
    if (level) supplierData.level = level;
    if (note) supplierData.note = note.trim();

    const supplier = await Supplier.create(supplierData);
    res.status(201).json(supplier);
  } catch (err) {
    if (err.name === 'ValidationError') {
      const messages = Object.values(err.errors).map(e => e.message);
      return res.status(400).json({ error: messages.join('；') });
    }
    res.status(500).json({ error: '服务器错误' });
  }
});

// ─── PUT /api/inv/suppliers/:id ─────────────────────────────────────────────
// Edit supplier
router.put('/:id', async (req, res) => {
  try {
    const { name, contactName, phone, email, address, level, note } = req.body;

    const updateFields = {};

    if (name !== undefined) {
      if (typeof name === 'string' && name.trim() === '') {
        return res.status(400).json({
          error: '供应商名称不能为空',
          code: 'VALIDATION_ERROR'
        });
      }
      updateFields.name = name.trim();
    }
    if (contactName !== undefined) updateFields.contactName = contactName;
    if (phone !== undefined) updateFields.phone = phone;
    if (email !== undefined) updateFields.email = email;
    if (address !== undefined) updateFields.address = address;
    if (level !== undefined) updateFields.level = level;
    if (note !== undefined) updateFields.note = note;

    if (Object.keys(updateFields).length === 0) {
      return res.status(400).json({ error: '没有提供需要更新的字段' });
    }

    updateFields.updatedAt = new Date();

    const supplier = await Supplier.findByIdAndUpdate(
      req.params.id,
      updateFields,
      { new: true, runValidators: true }
    );

    if (!supplier) {
      return res.status(404).json({ error: '供应商不存在' });
    }

    res.json(supplier);
  } catch (err) {
    if (err.name === 'CastError') {
      return res.status(404).json({ error: '供应商不存在' });
    }
    if (err.name === 'ValidationError') {
      const messages = Object.values(err.errors).map(e => e.message);
      return res.status(400).json({ error: messages.join('；') });
    }
    res.status(500).json({ error: '服务器错误' });
  }
});

// ─── GET /api/inv/suppliers/:id/account ─────────────────────────────────────
// Supplier account reconciliation: aggregate purchase amounts by time range
router.get('/:id/account', async (req, res) => {
  try {
    const { startDate, endDate } = req.query;

    // Verify supplier exists
    const supplier = await Supplier.findById(req.params.id);
    if (!supplier) {
      return res.status(404).json({ error: '供应商不存在' });
    }

    // Build query filter for PurchaseOrder
    const filter = { supplier: supplier._id };

    if (startDate || endDate) {
      filter.purchaseDate = {};
      if (startDate) {
        const start = new Date(startDate);
        if (!isNaN(start.getTime())) {
          filter.purchaseDate.$gte = start;
        }
      }
      if (endDate) {
        const end = new Date(endDate);
        if (!isNaN(end.getTime())) {
          end.setHours(23, 59, 59, 999);
          filter.purchaseDate.$lte = end;
        }
      }
      if (Object.keys(filter.purchaseDate).length === 0) {
        delete filter.purchaseDate;
      }
    }

    // Aggregate purchase orders
    const orders = await PurchaseOrder.find(filter).sort({ purchaseDate: -1 });

    const totalOrders = orders.length;
    const totalAmount = orders.reduce((sum, o) => sum + (o.totalAmount || 0), 0);

    // Group orders by status
    const ordersByStatus = {};
    for (const order of orders) {
      const status = order.status || 'pending';
      if (!ordersByStatus[status]) {
        ordersByStatus[status] = { count: 0, amount: 0, orders: [] };
      }
      ordersByStatus[status].count += 1;
      ordersByStatus[status].amount += order.totalAmount || 0;
      ordersByStatus[status].orders.push(order);
    }

    res.json({
      supplier: {
        _id: supplier._id,
        name: supplier.name,
        level: supplier.level
      },
      totalOrders,
      totalAmount: Math.round(totalAmount * 100) / 100,
      ordersByStatus
    });
  } catch (err) {
    if (err.name === 'CastError') {
      return res.status(404).json({ error: '供应商不存在' });
    }
    res.status(500).json({ error: '服务器错误' });
  }
});

// ─── PUT /api/inv/suppliers/:id/disable ─────────────────────────────────────
// Disable supplier (Admin only): set active=false, record disableReason and disabledAt
router.put('/:id/disable', requireRole('root'), async (req, res) => {
  try {
    const { reason } = req.body;

    const supplier = await Supplier.findById(req.params.id);
    if (!supplier) {
      return res.status(404).json({ error: '供应商不存在' });
    }

    if (!supplier.active) {
      return res.status(400).json({ error: '供应商已处于禁用状态' });
    }

    const now = new Date();
    supplier.active = false;
    supplier.disableReason = reason || undefined;
    supplier.disabledAt = now;
    supplier.updatedAt = now;
    await supplier.save();

    res.json(supplier);
  } catch (err) {
    if (err.name === 'CastError') {
      return res.status(404).json({ error: '供应商不存在' });
    }
    res.status(500).json({ error: '服务器错误' });
  }
});

// ─── PUT /api/inv/suppliers/:id/enable ──────────────────────────────────────
// Re-enable supplier (Admin only): set active=true, clear disableReason/disabledAt
router.put('/:id/enable', requireRole('root'), async (req, res) => {
  try {
    const supplier = await Supplier.findById(req.params.id);
    if (!supplier) {
      return res.status(404).json({ error: '供应商不存在' });
    }

    if (supplier.active) {
      return res.status(400).json({ error: '供应商已处于启用状态' });
    }

    const now = new Date();
    supplier.active = true;
    supplier.disableReason = undefined;
    supplier.disabledAt = undefined;
    supplier.updatedAt = now;
    await supplier.save();

    res.json(supplier);
  } catch (err) {
    if (err.name === 'CastError') {
      return res.status(404).json({ error: '供应商不存在' });
    }
    res.status(500).json({ error: '服务器错误' });
  }
});

// ─── DELETE /api/inv/suppliers/:id ──────────────────────────────────────────
// Permanently delete supplier (Admin only)
router.delete('/:id', requireRole('root'), async (req, res) => {
  try {
    const Supplier = require('../../models/inv/Supplier');
    const supplier = await Supplier.findById(req.params.id);
    if (!supplier) {
      return res.status(404).json({ error: '供应商不存在' });
    }

    // Check if supplier has purchase orders
    const PurchaseOrder = require('../../models/inv/PurchaseOrder');
    const hasPO = await PurchaseOrder.findOne({ supplier: req.params.id });
    if (hasPO) {
      return res.status(409).json({
        error: '该供应商已有采购记录，不可删除。请使用禁用功能。',
        code: 'HAS_PURCHASES'
      });
    }

    await Supplier.findByIdAndDelete(req.params.id);
    res.json({ message: '供应商已永久删除' });
  } catch (err) {
    if (err.name === 'CastError') {
      return res.status(404).json({ error: '供应商不存在' });
    }
    res.status(500).json({ error: '服务器错误' });
  }
});

module.exports = router;
