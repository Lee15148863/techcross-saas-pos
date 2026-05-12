const express = require('express');
const router = express.Router();
const Product = require('../../models/inv/Product');
const StockMovement = require('../../models/inv/StockMovement');
const StockRequest = require('../../models/inv/StockRequest');
const { jwtAuth, requireRole } = require('../../middleware/inv-auth');

// All routes require Staff+ access
router.use(jwtAuth, requireRole('root', 'manager', 'staff'));

// ─── POST /api/inv/stock/entry ──────────────────────────────────────────────
// Admin: direct entry. Staff: creates pending request for admin approval.
router.post('/entry', async (req, res) => {
  try {
    const { productId, quantity, note } = req.body;

    if (!productId) {
      return res.status(400).json({ error: '缺少必填字段：productId', code: 'VALIDATION_ERROR' });
    }
    if (quantity === undefined || quantity === null) {
      return res.status(400).json({ error: '缺少必填字段：quantity', code: 'VALIDATION_ERROR' });
    }
    if (!Number.isInteger(quantity) || quantity <= 0) {
      return res.status(400).json({ error: '入库数量必须为正整数', code: 'VALIDATION_ERROR' });
    }

    const product = await Product.findById(productId);
    if (!product) {
      return res.status(404).json({ error: '商品不存在', code: 'NOT_FOUND' });
    }

    // Staff: create pending request (manager+ can do direct entry)
    if (req.user.role === 'staff') {
      const request = await StockRequest.create({
        product: productId,
        type: 'entry',
        quantity,
        note: note || undefined,
        status: 'pending',
        requestedBy: req.user.userId
      });
      return res.status(201).json({
        message: '入库申请已提交，等待店主审批',
        request,
        pending: true
      });
    }

    // Admin: direct entry
    const movement = await StockMovement.create({
      product: productId,
      type: 'entry',
      quantity,
      operator: req.user.userId,
      referenceType: 'manual',
      note: note || undefined
    });

    product.stock += quantity;
    product.updatedAt = new Date();
    await product.save();

    res.status(201).json({
      movement,
      product: { _id: product._id, name: product.name, sku: product.sku, stock: product.stock },
      pending: false
    });
  } catch (err) {
    if (err.name === 'CastError') {
      return res.status(404).json({ error: '商品不存在', code: 'NOT_FOUND' });
    }
    res.status(500).json({ error: '服务器错误' });
  }
});

// ─── POST /api/inv/stock/exit ───────────────────────────────────────────────
// Manual stock exit: check stock sufficiency, create StockMovement(type='exit'), decrement product.stock
// Admin only — staff cannot directly adjust stock
router.post('/exit', requireRole('root', 'manager'), async (req, res) => {
  try {
    const { productId, quantity, note } = req.body;

    // Validate required fields
    if (!productId) {
      return res.status(400).json({ error: '缺少必填字段：productId', code: 'VALIDATION_ERROR' });
    }
    if (quantity === undefined || quantity === null) {
      return res.status(400).json({ error: '缺少必填字段：quantity', code: 'VALIDATION_ERROR' });
    }
    if (!Number.isInteger(quantity) || quantity <= 0) {
      return res.status(400).json({ error: '出库数量必须为正整数', code: 'VALIDATION_ERROR' });
    }

    // Find product
    const product = await Product.findById(productId);
    if (!product) {
      return res.status(404).json({ error: '商品不存在', code: 'NOT_FOUND' });
    }

    // Check stock sufficiency
    if (product.stock < quantity) {
      return res.status(400).json({
        error: '库存不足',
        code: 'INSUFFICIENT_STOCK',
        available: product.stock,
        requested: quantity
      });
    }

    // Create stock movement record
    const movement = await StockMovement.create({
      product: productId,
      type: 'exit',
      quantity,
      operator: req.user.userId,
      referenceType: 'manual',
      note: note || undefined
    });

    // Decrement product stock
    product.stock -= quantity;
    product.updatedAt = new Date();
    await product.save();

    res.status(201).json({
      movement,
      product: {
        _id: product._id,
        name: product.name,
        sku: product.sku,
        stock: product.stock
      }
    });
  } catch (err) {
    if (err.name === 'CastError') {
      return res.status(404).json({ error: '商品不存在', code: 'NOT_FOUND' });
    }
    res.status(500).json({ error: '服务器错误' });
  }
});

// ─── GET /api/inv/stock/history/:productId ──────────────────────────────────
// Stock movement history for a product, sorted by createdAt descending
// Supports time range filter: ?startDate=YYYY-MM-DD&endDate=YYYY-MM-DD
router.get('/history/:productId', async (req, res) => {
  try {
    const { productId } = req.params;
    const { startDate, endDate } = req.query;

    // Verify product exists
    const product = await Product.findById(productId);
    if (!product) {
      return res.status(404).json({ error: '商品不存在', code: 'NOT_FOUND' });
    }

    // Build query filter
    const filter = { product: productId };

    // Time range filter
    if (startDate || endDate) {
      filter.createdAt = {};
      if (startDate) {
        const start = new Date(startDate);
        if (!isNaN(start.getTime())) {
          filter.createdAt.$gte = start;
        }
      }
      if (endDate) {
        const end = new Date(endDate);
        if (!isNaN(end.getTime())) {
          // Set to end of day
          end.setHours(23, 59, 59, 999);
          filter.createdAt.$lte = end;
        }
      }
      // Remove empty createdAt filter
      if (Object.keys(filter.createdAt).length === 0) {
        delete filter.createdAt;
      }
    }

    const movements = await StockMovement.find(filter)
      .sort({ createdAt: -1 })
      .populate('operator', 'username displayName');

    res.json({
      product: {
        _id: product._id,
        name: product.name,
        sku: product.sku,
        stock: product.stock
      },
      movements
    });
  } catch (err) {
    if (err.name === 'CastError') {
      return res.status(404).json({ error: '商品不存在', code: 'NOT_FOUND' });
    }
    res.status(500).json({ error: '服务器错误' });
  }
});

// ─── GET /api/inv/stock/alerts ──────────────────────────────────────────────
// Low stock alerts: find all active products where stock > 0 AND stock <= lowStockThreshold
// Products with stock=0 are excluded (they may not track inventory)
router.get('/alerts', async (req, res) => {
  try {
    const alerts = await Product.find({
      active: true,
      stock: { $gt: 0 },
      $expr: { $lte: ['$stock', '$lowStockThreshold'] }
    }).select('name sku stock lowStockThreshold category').sort({ stock: 1 });

    res.json(alerts);
  } catch (err) {
    res.status(500).json({ error: '服务器错误' });
  }
});

// ─── POST /api/inv/stock/reconcile ──────────────────────────────────────────
// Stock reconciliation (Admin only): compare product.stock with net stock from StockMovement records
router.post('/reconcile', requireRole('root', 'manager'), async (req, res) => {
  try {
    // Get all active products
    const products = await Product.find({ active: true }).select('name sku stock');

    if (products.length === 0) {
      return res.json({ message: '没有活跃商品需要核对', discrepancies: [] });
    }

    const productIds = products.map(p => p._id);

    // Aggregate net stock from StockMovement records for each product
    const entryAgg = await StockMovement.aggregate([
      { $match: { product: { $in: productIds }, type: 'entry' } },
      { $group: { _id: '$product', totalEntry: { $sum: '$quantity' } } }
    ]);

    const exitAgg = await StockMovement.aggregate([
      { $match: { product: { $in: productIds }, type: 'exit' } },
      { $group: { _id: '$product', totalExit: { $sum: '$quantity' } } }
    ]);

    // Build lookup maps
    const entryMap = {};
    for (const e of entryAgg) {
      entryMap[e._id.toString()] = e.totalEntry;
    }
    const exitMap = {};
    for (const e of exitAgg) {
      exitMap[e._id.toString()] = e.totalExit;
    }

    // Compare and build discrepancy report
    const report = [];
    for (const product of products) {
      const pid = product._id.toString();
      const totalEntry = entryMap[pid] || 0;
      const totalExit = exitMap[pid] || 0;
      const expectedStock = totalEntry - totalExit;
      const actualStock = product.stock;
      const difference = actualStock - expectedStock;

      report.push({
        product: {
          _id: product._id,
          name: product.name,
          sku: product.sku
        },
        expectedStock,
        actualStock,
        difference
      });
    }

    // Filter to only discrepancies (difference !== 0) or return all if requested
    const showAll = req.query.showAll === 'true';
    const discrepancies = showAll ? report : report.filter(r => r.difference !== 0);

    res.json({
      totalProducts: products.length,
      discrepancyCount: report.filter(r => r.difference !== 0).length,
      discrepancies
    });
  } catch (err) {
    res.status(500).json({ error: '服务器错误' });
  }
});

module.exports = router;
