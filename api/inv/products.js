const express = require('express');
const router = express.Router();
const Product = require('../../models/inv/Product');
const { jwtAuth, requireRole } = require('../../middleware/inv-auth');
const { validateRequiredFields } = require('../../utils/inv-validators');
const { calculateMarginVat } = require('../../utils/inv-vat-calculator');

// All routes require Staff+ access
router.use(jwtAuth, requireRole('root', 'manager', 'staff'));

// ─── Category attribute templates ───────────────────────────────────────────
const CATEGORY_TEMPLATES = {
  '销售': {},
  '维修': {},
  '服务': {},
  '新机': { '品牌': '', '型号': '', '存储容量': '' },
  '二手': { '成色': '', '电池健康度': '', '维修记录': '' }
};

// ─── GET /api/inv/products/search ───────────────────────────────────────────
// Fuzzy search by name/SKU/IMEI (case-insensitive)
// Must be defined BEFORE /:id to avoid route conflict
router.get('/search', async (req, res) => {
  try {
    const { q } = req.query;
    if (!q || typeof q !== 'string' || q.trim() === '') {
      return res.json([]);
    }

    const keyword = q.trim();
    const escapedKeyword = keyword.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const regex = new RegExp(escapedKeyword, 'i');

    const products = await Product.find({
      active: true,
      $or: [
        { name: regex },
        { sku: regex },
        { serialNumber: regex }
      ]
    }).limit(50).sort({ updatedAt: -1 });

    res.json(products);
  } catch (err) {
    res.status(500).json({ error: '服务器错误' });
  }
});

// ─── GET /api/inv/products/templates ────────────────────────────────────────
// Return category attribute templates; unknown categories get empty object
router.get('/templates', (req, res) => {
  const { category } = req.query;
  if (category) {
    return res.json(CATEGORY_TEMPLATES[category] || {});
  }
  res.json(CATEGORY_TEMPLATES);
});

// ─── GET /api/inv/products ──────────────────────────────────────────────────
// Product list with pagination, category filter, active filter
router.get('/', async (req, res) => {
  try {
    const page = Math.max(1, parseInt(req.query.page) || 1);
    const limit = Math.min(100, Math.max(1, parseInt(req.query.limit) || 20));
    const skip = (page - 1) * limit;

    const filter = {};

    // Category filter
    if (req.query.category) {
      filter.category = req.query.category;
    }

    // Active filter
    if (req.query.active !== undefined) {
      filter.active = req.query.active === 'true';
    }

    // Keyword search filter (name, SKU, serialNumber)
    if (req.query.q && typeof req.query.q === 'string' && req.query.q.trim() !== '') {
      const keyword = req.query.q.trim();
      const escapedKw = keyword.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const searchRegex = new RegExp(escapedKw, 'i');
      filter.$or = [
        { name: searchRegex },
        { sku: searchRegex },
        { serialNumber: searchRegex }
      ];
    }

    const [products, total] = await Promise.all([
      Product.find(filter).skip(skip).limit(limit).sort({ updatedAt: -1 }),
      Product.countDocuments(filter)
    ]);

    res.json({
      data: products,
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit)
      }
    });
  } catch (err) {
    res.status(500).json({ error: '服务器错误' });
  }
});

// ─── GET /api/inv/products/:id ──────────────────────────────────────────────
// Product detail with all custom attributes
router.get('/:id', async (req, res) => {
  try {
    const product = await Product.findById(req.params.id);
    if (!product) {
      return res.status(404).json({ error: '商品不存在' });
    }

    const result = product.toObject();

    // For second-hand products, display margin info
    if (result.isSecondHand) {
      result.margin = Math.round((result.sellingPrice - result.costPrice) * 100) / 100;
      result.marginVat = calculateMarginVat(result.sellingPrice, result.costPrice);
    }

    res.json(result);
  } catch (err) {
    if (err.name === 'CastError') {
      return res.status(404).json({ error: '商品不存在' });
    }
    res.status(500).json({ error: '服务器错误' });
  }
});

// ─── POST /api/inv/products ─────────────────────────────────────────────────
// Create product
router.post('/', async (req, res) => {
  try {
    const {
      name, sku, category, costPrice, sellingPrice, vatRate,
      stock, isSecondHand, purchasedFromCustomer, source, marginScheme,
      serialNumber, attributes, lowStockThreshold
    } = req.body;

    // Required fields validation
    const missing = validateRequiredFields(req.body, ['name', 'sku', 'sellingPrice']);
    if (missing.length > 0) {
      return res.status(400).json({
        error: `缺少必填字段：${missing.join('、')}`,
        fields: missing
      });
    }

    // costPrice: required for second-hand (margin scheme), optional for others
    if (costPrice !== undefined && costPrice !== null) {
      if (typeof costPrice !== 'number' || costPrice < 0) {
        return res.status(400).json({ error: '成本价必须为非负数' });
      }
    }

    // vatRate validation (0-1 range, e.g. 0.23 for 23%)
    let effectiveVatRate = 0.23; // default
    if (vatRate !== undefined && vatRate !== null) {
      if (typeof vatRate !== 'number' || vatRate < 0 || vatRate > 1) {
        return res.status(400).json({ error: 'VAT 税率必须在 0-1 之间（如 0.23 表示 23%）' });
      }
      effectiveVatRate = vatRate;
    }

    // Category is required
    if (!category || (typeof category === 'string' && category.trim() === '')) {
      return res.status(400).json({
        error: '缺少必填字段：category',
        fields: ['category']
      });
    }

    // SKU uniqueness check (no format validation - accept any string including barcodes)
    const existingSku = await Product.findOne({ sku });
    if (existingSku) {
      return res.status(400).json({ error: 'SKU/Barcode 已存在', code: 'SKU_DUPLICATE' });
    }

    // Second-hand product: serialNumber is required
    if (isSecondHand && (!serialNumber || (typeof serialNumber === 'string' && serialNumber.trim() === ''))) {
      return res.status(400).json({
        error: '二手商品必须提供序列号（IMEI/SN）',
        code: 'SERIAL_REQUIRED'
      });
    }

    // Non-second-hand products cannot have isSecondHand flag
    // (isSecondHand binds to Margin VAT — this is enforced by the schema default)

    // Build product data
    const productData = {
      name: name.trim(),
      sku: sku.trim(),
      category: category.trim(),
      costPrice: costPrice || 0,
      sellingPrice,
      vatRate: effectiveVatRate,
      stock: stock || 0,
      isSecondHand: !!isSecondHand,
      purchasedFromCustomer: !!purchasedFromCustomer,
      source: source || '',
      marginScheme: !!marginScheme,
      active: true
    };

    if (serialNumber) productData.serialNumber = serialNumber.trim();
    if (attributes) productData.attributes = attributes;
    if (lowStockThreshold !== undefined) productData.lowStockThreshold = lowStockThreshold;

    const product = await Product.create(productData);

    const result = product.toObject();

    // For second-hand products, include margin info in response
    if (result.isSecondHand) {
      result.margin = Math.round((result.sellingPrice - result.costPrice) * 100) / 100;
      result.marginVat = calculateMarginVat(result.sellingPrice, result.costPrice);
    }

    res.status(201).json(result);
  } catch (err) {
    if (err.code === 11000) {
      return res.status(400).json({ error: 'SKU 已存在', code: 'SKU_DUPLICATE' });
    }
    if (err.name === 'ValidationError') {
      const messages = Object.values(err.errors).map(e => e.message);
      return res.status(400).json({ error: messages.join('；') });
    }
    res.status(500).json({ error: '服务器错误' });
  }
});

// ─── PUT /api/inv/products/:id ──────────────────────────────────────────────
// Edit product, preserve updatedAt timestamp
router.put('/:id', async (req, res) => {
  try {
    const {
      name, sku, category, costPrice, sellingPrice, vatRate,
      stock, isSecondHand, purchasedFromCustomer, source, marginScheme,
      serialNumber, attributes, lowStockThreshold, active
    } = req.body;

    const updateFields = {};

    if (name !== undefined) updateFields.name = name.trim();
    if (category !== undefined) updateFields.category = category.trim();
    if (costPrice !== undefined) {
      if (typeof costPrice !== 'number' || costPrice < 0) {
        return res.status(400).json({ error: '成本价必须为非负数' });
      }
      updateFields.costPrice = costPrice;
    }
    if (sellingPrice !== undefined) updateFields.sellingPrice = sellingPrice;
    if (vatRate !== undefined) {
      if (typeof vatRate !== 'number' || vatRate < 0 || vatRate > 1) {
        return res.status(400).json({ error: 'VAT 税率必须在 0-1 之间' });
      }
      updateFields.vatRate = vatRate;
    }
    if (stock !== undefined) {
      // Only admin (root/manager) can modify stock
      if (req.user.role === 'staff') {
        return res.status(403).json({ error: '只有店主可以修改库存数量', code: 'FORBIDDEN' });
      }
      updateFields.stock = stock;
    }
    if (isSecondHand !== undefined) updateFields.isSecondHand = isSecondHand;
    if (purchasedFromCustomer !== undefined) updateFields.purchasedFromCustomer = purchasedFromCustomer;
    if (source !== undefined) updateFields.source = source;
    if (marginScheme !== undefined) updateFields.marginScheme = marginScheme;
    if (serialNumber !== undefined) updateFields.serialNumber = serialNumber.trim();
    if (attributes !== undefined) updateFields.attributes = attributes;
    if (lowStockThreshold !== undefined) updateFields.lowStockThreshold = lowStockThreshold;
    if (active !== undefined) updateFields.active = active;

    // deadStock flag
    if (req.body.deadStock !== undefined) updateFields.deadStock = req.body.deadStock;

    // SKU update with uniqueness check (no format validation - accept any string including barcodes)
    if (sku !== undefined) {
      // Check uniqueness (exclude current product)
      const existingSku = await Product.findOne({ sku, _id: { $ne: req.params.id } });
      if (existingSku) {
        return res.status(400).json({ error: 'SKU/Barcode 已存在', code: 'SKU_DUPLICATE' });
      }
      updateFields.sku = sku.trim();
    }

    // If updating to second-hand, serialNumber is required
    if (updateFields.isSecondHand === true) {
      // Check if serialNumber is being provided in this update or already exists
      const currentProduct = await Product.findById(req.params.id);
      if (!currentProduct) {
        return res.status(404).json({ error: '商品不存在' });
      }
      const effectiveSerial = updateFields.serialNumber !== undefined
        ? updateFields.serialNumber
        : currentProduct.serialNumber;
      if (!effectiveSerial || effectiveSerial.trim() === '') {
        return res.status(400).json({
          error: '二手商品必须提供序列号（IMEI/SN）',
          code: 'SERIAL_REQUIRED'
        });
      }
    }

    if (Object.keys(updateFields).length === 0) {
      return res.status(400).json({ error: '没有提供需要更新的字段' });
    }

    // Preserve updatedAt timestamp
    updateFields.updatedAt = new Date();

    const product = await Product.findByIdAndUpdate(
      req.params.id,
      updateFields,
      { new: true, runValidators: true }
    );

    if (!product) {
      return res.status(404).json({ error: '商品不存在' });
    }

    const result = product.toObject();

    // For second-hand products, include margin info
    if (result.isSecondHand) {
      result.margin = Math.round((result.sellingPrice - result.costPrice) * 100) / 100;
      result.marginVat = calculateMarginVat(result.sellingPrice, result.costPrice);
    }

    res.json(result);
  } catch (err) {
    if (err.name === 'CastError') {
      return res.status(404).json({ error: '商品不存在' });
    }
    if (err.code === 11000) {
      return res.status(400).json({ error: 'SKU 已存在', code: 'SKU_DUPLICATE' });
    }
    if (err.name === 'ValidationError') {
      const messages = Object.values(err.errors).map(e => e.message);
      return res.status(400).json({ error: messages.join('；') });
    }
    res.status(500).json({ error: '服务器错误' });
  }
});

// ─── PUT /api/inv/products/:id/disable ──────────────────────────────────────
// Soft delete (mark as inactive)
router.put('/:id/disable', async (req, res) => {
  try {
    const product = await Product.findByIdAndUpdate(
      req.params.id,
      { active: false, updatedAt: new Date() },
      { new: true }
    );

    if (!product) {
      return res.status(404).json({ error: '商品不存在' });
    }

    res.json(product);
  } catch (err) {
    if (err.name === 'CastError') {
      return res.status(404).json({ error: '商品不存在' });
    }
    res.status(500).json({ error: '服务器错误' });
  }
});

// ─── PUT /api/inv/products/:id/dead-stock ───────────────────────────────────
// Toggle dead stock flag (Admin only)
router.put('/:id/dead-stock', requireRole('root'), async (req, res) => {
  try {
    const product = await Product.findById(req.params.id);
    if (!product) {
      return res.status(404).json({ error: '商品不存在' });
    }

    product.deadStock = !product.deadStock;
    product.updatedAt = new Date();
    await product.save();

    res.json({ _id: product._id, name: product.name, deadStock: product.deadStock, stock: product.stock });
  } catch (err) {
    if (err.name === 'CastError') {
      return res.status(404).json({ error: '商品不存在' });
    }
    res.status(500).json({ error: '服务器错误' });
  }
});

// ─── DELETE /api/inv/products/:id ───────────────────────────────────────────
// Permanently delete a product (Admin only)
router.delete('/:id', requireRole('root'), async (req, res) => {
  try {
    const product = await Product.findById(req.params.id);
    if (!product) {
      return res.status(404).json({ error: '商品不存在' });
    }

    // Check if product has been used in transactions
    const Transaction = require('../../models/inv/Transaction');
    const usedInTx = await Transaction.findOne({ 'items.product': req.params.id });
    if (usedInTx) {
      return res.status(409).json({
        error: '该商品已有交易记录，不可删除。请使用停用功能。',
        code: 'HAS_TRANSACTIONS'
      });
    }

    await Product.findByIdAndDelete(req.params.id);

    // Also clean up any stock movements for this product
    const StockMovement = require('../../models/inv/StockMovement');
    await StockMovement.deleteMany({ product: req.params.id });

    res.json({ message: '商品已永久删除' });
  } catch (err) {
    if (err.name === 'CastError') {
      return res.status(404).json({ error: '商品不存在' });
    }
    res.status(500).json({ error: '服务器错误' });
  }
});

module.exports = router;
