const express = require('express');
const router = express.Router();
const PurchaseOrder = require('../../models/inv/PurchaseOrder');
const Product = require('../../models/inv/Product');
const StockMovement = require('../../models/inv/StockMovement');
const Supplier = require('../../models/inv/Supplier');
const { jwtAuth, requireRole } = require('../../middleware/inv-auth');

// All routes require Staff+ access
router.use(jwtAuth, requireRole('root', 'manager', 'staff'));

// ─── GET /api/inv/purchases ─────────────────────────────────────────────────
// Purchase order list, support status filter (?status=pending|received|cancelled)
router.get('/', async (req, res) => {
  try {
    const filter = {};

    // Status filter
    const validStatuses = ['pending', 'received', 'cancelled'];
    if (req.query.status && validStatuses.includes(req.query.status)) {
      filter.status = req.query.status;
    }

    const orders = await PurchaseOrder.find(filter)
      .populate('supplier', 'name level')
      .populate('operator', 'username displayName')
      .sort({ purchaseDate: -1 });

    res.json(orders);
  } catch (err) {
    res.status(500).json({ error: '服务器错误' });
  }
});

// ─── GET /api/inv/purchases/:id ─────────────────────────────────────────────
// Purchase order detail, populate supplier and product info
router.get('/:id', async (req, res) => {
  try {
    const order = await PurchaseOrder.findById(req.params.id)
      .populate('supplier')
      .populate('items.product', 'name sku category sellingPrice costPrice stock active')
      .populate('operator', 'username displayName');

    if (!order) {
      return res.status(404).json({ error: '采购单不存在' });
    }

    res.json(order);
  } catch (err) {
    if (err.name === 'CastError') {
      return res.status(404).json({ error: '采购单不存在' });
    }
    res.status(500).json({ error: '服务器错误' });
  }
});

// ─── POST /api/inv/purchases ────────────────────────────────────────────────
// Create purchase order
router.post('/', async (req, res) => {
  try {
    const { supplier, items, expectedArrival, note } = req.body;

    // Validate required: supplier
    if (!supplier) {
      return res.status(400).json({ error: '缺少必填字段：supplier', code: 'VALIDATION_ERROR' });
    }

    // Validate required: items array
    if (!items || !Array.isArray(items) || items.length === 0) {
      return res.status(400).json({ error: '缺少必填字段：items', code: 'VALIDATION_ERROR' });
    }

    // Validate each item has product, quantity, unitPrice
    for (let i = 0; i < items.length; i++) {
      const item = items[i];
      if (!item.product) {
        return res.status(400).json({
          error: `items[${i}] 缺少必填字段：product`,
          code: 'VALIDATION_ERROR'
        });
      }
      if (item.quantity === undefined || item.quantity === null || !Number.isInteger(item.quantity) || item.quantity <= 0) {
        return res.status(400).json({
          error: `items[${i}] 数量必须为正整数`,
          code: 'VALIDATION_ERROR'
        });
      }
      if (item.unitPrice === undefined || item.unitPrice === null || typeof item.unitPrice !== 'number' || item.unitPrice < 0) {
        return res.status(400).json({
          error: `items[${i}] 单价必须为非负数`,
          code: 'VALIDATION_ERROR'
        });
      }
    }

    // Verify supplier exists
    const supplierDoc = await Supplier.findById(supplier);
    if (!supplierDoc) {
      return res.status(404).json({ error: '供应商不存在', code: 'NOT_FOUND' });
    }

    // Validate all products are active (not disabled)
    const productIds = items.map(item => item.product);
    const products = await Product.find({ _id: { $in: productIds } });

    if (products.length !== productIds.length) {
      return res.status(400).json({ error: '部分商品不存在', code: 'VALIDATION_ERROR' });
    }

    const inactiveProducts = products.filter(p => !p.active);
    if (inactiveProducts.length > 0) {
      const names = inactiveProducts.map(p => p.name).join('、');
      return res.status(400).json({
        error: `以下商品已停用，无法采购：${names}`,
        code: 'PRODUCT_DISABLED'
      });
    }

    // Auto-calculate totalAmount
    const totalAmount = items.reduce((sum, item) => {
      return sum + item.quantity * item.unitPrice;
    }, 0);

    // Generate orderNumber (PO-YYYYMMDDHHmmss format)
    const now = new Date();
    const pad = (n, len = 2) => String(n).padStart(len, '0');
    const orderNumber = `PO-${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;

    const orderData = {
      orderNumber,
      supplier,
      items: items.map(item => ({
        product: item.product,
        quantity: item.quantity,
        unitPrice: item.unitPrice
      })),
      totalAmount: Math.round(totalAmount * 100) / 100,
      operator: req.user.userId,
      status: 'pending'
    };

    if (expectedArrival) orderData.expectedArrival = expectedArrival;
    if (note) orderData.note = note;

    const order = await PurchaseOrder.create(orderData);

    // Populate supplier for response (include level for display)
    const populatedOrder = await PurchaseOrder.findById(order._id)
      .populate('supplier', 'name level contactName phone');

    res.status(201).json(populatedOrder);
  } catch (err) {
    if (err.name === 'CastError') {
      return res.status(400).json({ error: '无效的ID格式', code: 'VALIDATION_ERROR' });
    }
    if (err.name === 'ValidationError') {
      const messages = Object.values(err.errors).map(e => e.message);
      return res.status(400).json({ error: messages.join('；') });
    }
    if (err.code === 11000) {
      return res.status(409).json({ error: '采购单号重复，请重试', code: 'DUPLICATE_ORDER' });
    }
    res.status(500).json({ error: '服务器错误' });
  }
});

// ─── PUT /api/inv/purchases/:id ─────────────────────────────────────────────
// Edit purchase order (only if status is 'pending')
router.put('/:id', async (req, res) => {
  try {
    const order = await PurchaseOrder.findById(req.params.id);
    if (!order) {
      return res.status(404).json({ error: '采购单不存在' });
    }

    if (order.status !== 'pending') {
      return res.status(400).json({
        error: '只能编辑待处理状态的采购单',
        code: 'INVALID_STATUS'
      });
    }

    const { supplier, items, expectedArrival, note } = req.body;

    if (supplier) {
      const supplierDoc = await Supplier.findById(supplier);
      if (!supplierDoc) {
        return res.status(404).json({ error: '供应商不存在', code: 'NOT_FOUND' });
      }
      order.supplier = supplier;
    }

    if (items && Array.isArray(items) && items.length > 0) {
      // Validate each item
      for (let i = 0; i < items.length; i++) {
        const item = items[i];
        if (!item.product) {
          return res.status(400).json({
            error: `items[${i}] 缺少必填字段：product`,
            code: 'VALIDATION_ERROR'
          });
        }
        if (item.quantity === undefined || item.quantity === null || !Number.isInteger(item.quantity) || item.quantity <= 0) {
          return res.status(400).json({
            error: `items[${i}] 数量必须为正整数`,
            code: 'VALIDATION_ERROR'
          });
        }
        if (item.unitPrice === undefined || item.unitPrice === null || typeof item.unitPrice !== 'number' || item.unitPrice < 0) {
          return res.status(400).json({
            error: `items[${i}] 单价必须为非负数`,
            code: 'VALIDATION_ERROR'
          });
        }
      }

      // Validate all products are active
      const productIds = items.map(item => item.product);
      const products = await Product.find({ _id: { $in: productIds } });

      if (products.length !== productIds.length) {
        return res.status(400).json({ error: '部分商品不存在', code: 'VALIDATION_ERROR' });
      }

      const inactiveProducts = products.filter(p => !p.active);
      if (inactiveProducts.length > 0) {
        const names = inactiveProducts.map(p => p.name).join('、');
        return res.status(400).json({
          error: `以下商品已停用，无法采购：${names}`,
          code: 'PRODUCT_DISABLED'
        });
      }

      order.items = items.map(item => ({
        product: item.product,
        quantity: item.quantity,
        unitPrice: item.unitPrice
      }));

      // Recalculate totalAmount
      order.totalAmount = Math.round(
        items.reduce((sum, item) => sum + item.quantity * item.unitPrice, 0) * 100
      ) / 100;
    }

    if (expectedArrival !== undefined) order.expectedArrival = expectedArrival || undefined;
    if (note !== undefined) order.note = note || undefined;

    order.updatedAt = new Date();
    await order.save();

    const populatedOrder = await PurchaseOrder.findById(order._id)
      .populate('supplier', 'name level')
      .populate('items.product', 'name sku category')
      .populate('operator', 'username displayName');

    res.json(populatedOrder);
  } catch (err) {
    if (err.name === 'CastError') {
      return res.status(404).json({ error: '采购单不存在' });
    }
    if (err.name === 'ValidationError') {
      const messages = Object.values(err.errors).map(e => e.message);
      return res.status(400).json({ error: messages.join('；') });
    }
    res.status(500).json({ error: '服务器错误' });
  }
});

// ─── PUT /api/inv/purchases/:id/receive ─────────────────────────────────────
// Confirm receipt: change status to 'received', auto-create StockMovement entries
router.put('/:id/receive', async (req, res) => {
  try {
    const order = await PurchaseOrder.findById(req.params.id);
    if (!order) {
      return res.status(404).json({ error: '采购单不存在' });
    }

    if (order.status !== 'pending') {
      return res.status(400).json({
        error: '只有待处理状态的采购单可以确认收货',
        code: 'INVALID_STATUS'
      });
    }

    // Update order status
    order.status = 'received';
    order.receivedAt = new Date();
    order.updatedAt = new Date();
    await order.save();

    // Auto-create StockMovement for each item and increment product stock
    for (const item of order.items) {
      await StockMovement.create({
        product: item.product,
        type: 'entry',
        quantity: item.quantity,
        operator: req.user.userId,
        referenceId: order._id.toString(),
        referenceType: 'purchase',
        note: `采购入库 - 采购单 ${order.orderNumber}`
      });

      await Product.findByIdAndUpdate(item.product, {
        $inc: { stock: item.quantity },
        updatedAt: new Date()
      });
    }

    const populatedOrder = await PurchaseOrder.findById(order._id)
      .populate('supplier', 'name level')
      .populate('items.product', 'name sku stock')
      .populate('operator', 'username displayName');

    res.json(populatedOrder);
  } catch (err) {
    if (err.name === 'CastError') {
      return res.status(404).json({ error: '采购单不存在' });
    }
    res.status(500).json({ error: '服务器错误' });
  }
});

// ─── PUT /api/inv/purchases/:id/cancel ──────────────────────────────────────
// Cancel purchase order (only if status is 'pending')
router.put('/:id/cancel', async (req, res) => {
  try {
    const order = await PurchaseOrder.findById(req.params.id);
    if (!order) {
      return res.status(404).json({ error: '采购单不存在' });
    }

    if (order.status !== 'pending') {
      return res.status(400).json({
        error: '只能取消待处理状态的采购单',
        code: 'INVALID_STATUS'
      });
    }

    order.status = 'cancelled';
    order.updatedAt = new Date();
    await order.save();

    res.json(order);
  } catch (err) {
    if (err.name === 'CastError') {
      return res.status(404).json({ error: '采购单不存在' });
    }
    res.status(500).json({ error: '服务器错误' });
  }
});

module.exports = router;
