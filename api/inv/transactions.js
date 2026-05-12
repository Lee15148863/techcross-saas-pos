const express = require('express');
const router = express.Router();
const { encryptData } = require('../../utils/inv-crypto');
const Transaction = require('../../models/inv/Transaction');
const Product = require('../../models/inv/Product');
const StockMovement = require('../../models/inv/StockMovement');
const AuditLog = require('../../models/inv/AuditLog');
const DailyClose = require('../../models/inv/DailyClose');
const MonthlyReport = require('../../models/inv/MonthlyReport');
const { jwtAuth, requireRole } = require('../../middleware/inv-auth');
const { authorize, SOURCES } = require('../../utils/inv-integrity-layer');

// All routes require Staff+ access
router.use(jwtAuth, requireRole('root', 'manager', 'staff'));

const { generateReceiptNumber } = require('../../utils/inv-receipt-number');

// ─── Helper: Generate receipt number (delegates to inv-receipt-number) ──────

// ─── POST /api/inv/transactions/calculate ──────────────────────────────────
// Lightweight cart calculation — computes totals without persisting anything
router.post('/calculate', async (req, res) => {
  try {
    const { items, orderDiscount } = req.body;

    if (!Array.isArray(items) || items.length === 0) {
      return res.status(400).json({ error: 'Cart is empty', code: 'EMPTY_CART' });
    }

    const productIds = items.map(i => i.product).filter(Boolean);
    const products = await Product.find({ _id: { $in: productIds } });
    const productMap = {};
    for (const p of products) productMap[p._id.toString()] = { name: p.name, sellingPrice: p.sellingPrice, costPrice: p.costPrice, marginScheme: p.marginScheme || false, vatRate: p.vatRate || 0.23, active: p.active };

    const calcItems = [];
    const resultItems = [];

    for (let i = 0; i < items.length; i++) {
      const item = items[i];
      const product = productMap[item.product];
      if (!product || !product.active) continue;

      const quantity = item.quantity || 1;
      calcItems.push({
        unitPrice: product.sellingPrice,
        costPrice: product.costPrice,
        quantity,
        isSecondHand: product.marginScheme,
        vatRate: product.vatRate,
        discount: item.discount || null,
      });
      resultItems.push({
        product: item.product,
        name: product.name,
        vatRate: product.vatRate,
        marginScheme: product.marginScheme,
      });
    }

    const { calculateDiscountedCart } = require('../../utils/inv-discount-calculator');
    const { DEFAULT_VAT_RATE } = require('../../utils/inv-vat-calculator');
    const result = calculateDiscountedCart(calcItems, orderDiscount || null, DEFAULT_VAT_RATE);

    // Merge computed values back into item response
    result.items.forEach((ci, i) => {
      if (resultItems[i]) {
        resultItems[i].quantity = ci.quantity;
        resultItems[i].unitPrice = ci.unitPrice;
        resultItems[i].discountedPrice = ci.discountedPrice;
        resultItems[i].subtotal = ci.subtotal;
        resultItems[i].vatAmount = ci.vatAmount;
        resultItems[i].marginVat = ci.marginVat;
      }
    });

    res.json({
      items: resultItems,
      subtotalBeforeOrderDiscount: result.subtotalBeforeOrderDiscount,
      orderDiscountAmount: result.orderDiscountAmount,
      totalAmount: result.totalAmount,
      standardVatTotal: result.standardVatTotal,
      marginVatTotal: result.marginVatTotal,
    });
  } catch (err) {
    res.status(500).json({ error: 'Calculation error', code: 'CALCULATION_ERROR' });
  }
});

// ─── POST /api/inv/transactions/checkout ────────────────────────────────────
// Core checkout endpoint — thin controller, delegates all business logic to service
router.post('/checkout', async (req, res) => {
  try {
    const { checkout } = require('../../services/inv-checkout-service');

    const result = await checkout({
      items: req.body.items,
      orderDiscount: req.body.orderDiscount,
      paymentMethod: req.body.paymentMethod,
      cashReceived: req.body.cashReceived,
      cardAmount: req.body.cardAmount,
      operator: req.user.userId,
      discountOperator: req.body.discountOperator,
    });

    const response = { transaction: result.transaction, receipt: result.receiptData };
    if (result.stockErrors && result.stockErrors.length > 0) {
      response.stockWarnings = result.stockErrors;
      response.message = '交易成功，但部分库存更新失败，请店主核对';
    }
    res.status(201).json(response);
  } catch (err) {
    if (err.name === 'CastError') {
      return res.status(400).json({ error: '无效的ID格式', code: 'VALIDATION_ERROR' });
    }
    if (err.code === 11000) {
      return res.status(409).json({ error: '小票号重复，请重试', code: 'DUPLICATE_RECEIPT' });
    }
    // Map service-layer error codes to HTTP responses
    switch (err.code) {
      case 'EMPTY_CART':
        return res.status(400).json({ error: '购物车为空', code: err.code });
      case 'VALIDATION_ERROR':
        return res.status(400).json({ error: err.message, code: err.code });
      case 'NOT_FOUND':
        return res.status(404).json({ error: err.message, code: err.code });
      case 'PRODUCT_DISABLED':
        return res.status(400).json({ error: err.message, code: err.code });
      case 'DISCOUNT_BELOW_COST':
        return res.status(400).json({ error: err.message, code: err.code });
      case 'INSUFFICIENT_PAYMENT':
        return res.status(400).json({ error: err.message, code: err.code });
      case 'ATOMIC_FAILURE':
        return res.status(500).json({ error: '交易处理失败，请重试', code: err.code });
      default:
        res.status(500).json({ error: '服务器错误' });
    }
  }
});

// ─── POST /api/inv/transactions/refund ──────────────────────────────────────
// Process refund — delegates to refund service for receipt-based refunds.
// Manual refunds (no receipt number) use a simplified path.
router.post('/refund', async (req, res) => {
  try {
    const { receiptNumber, items, refundMethod, reason } = req.body;

    if (!refundMethod || !['cash', 'card'].includes(refundMethod)) {
      return res.status(400).json({ error: '退款方式必须是现金或银行卡', code: 'VALIDATION_ERROR' });
    }

    if (receiptNumber) {
      // ── Receipt-based refund (full or partial) ──
      // Delegates all business logic to the refund service, which handles:
      //   - Original transaction lookup & duplicate prevention
      //   - Atomic Transaction + CashLedger + Device lifecycle
      //   - Best-effort stock restoration
      const { processRefund } = require('../../services/inv-refund-service');
      const result = await processRefund({
        receiptNumber,
        items,
        refundMethod,
        reason,
        operator: req.user.userId,
      });

      return res.status(201).json({
        message: '退款成功',
        refund: {
          receiptNumber: result.transaction.receiptNumber,
          totalRefund: result.totalRefund,
          refundMethod: result.refundMethod,
          items: result.refundItems,
          originalReceipt: result.originalReceipt,
        },
      });
    }

    // ── Manual refund (no receipt number, simplified path) ─────────
    // Limited: no atomicity, no CashLedger entry, no device lifecycle.
    // Only creates a Transaction record for audit.
    if (!items || !Array.isArray(items) || items.length === 0) {
      return res.status(400).json({ error: 'No items to refund', code: 'VALIDATION_ERROR' });
    }

    const refundItems = [];
    for (const ri of items) {
      if (!ri.name || !ri.amount) continue;
      refundItems.push({
        name: ri.name,
        sku: ri.sku || '',
        quantity: ri.quantity || 1,
        unitPrice: ri.amount,
        vatRate: ri.vatRate || 0.23,
      });
    }

    if (!refundItems.length) {
      return res.status(400).json({ error: 'No valid refund items', code: 'VALIDATION_ERROR' });
    }

    const totalRefund = Math.round(refundItems.reduce((sum, i) => sum + (i.unitPrice * i.quantity), 0) * 100) / 100;

    const refundTxItems = refundItems.map(i => {
      const rate = i.vatRate || 0.23;
      const perUnit = Math.round(i.unitPrice * rate / (1 + rate) * 100) / 100;
      const vatAmt = Math.round(perUnit * i.quantity * 100) / 100;
      return {
        name: i.name,
        sku: i.sku,
        quantity: i.quantity,
        unitPrice: -i.unitPrice,
        costPrice: 0,
        vatRate: rate,
        discountedPrice: -i.unitPrice,
        subtotal: -(i.unitPrice * i.quantity),
        vatAmount: -vatAmt,
        marginVat: 0,
      };
    });

    const refundReceiptNumber = generateReceiptNumber('refund');

    const refundTxn = authorize(new Transaction({
      receiptNumber: refundReceiptNumber,
      items: refundTxItems,
      totalAmount: -totalRefund,
      standardVatTotal: refundTxItems.reduce((s, it) => s + (it.vatAmount || 0), 0),
      marginVatTotal: 0,
      paymentMethod: refundMethod,
      cashReceived: refundMethod === 'cash' ? -totalRefund : null,
      cardAmount: refundMethod === 'card' ? -totalRefund : null,
      changeGiven: refundMethod === 'cash' ? 0 : null,
      originalReceipt: null,
      operator: req.user.userId,
    }), SOURCES.REFUND);
    await refundTxn.save();

    return res.status(201).json({
      message: '退款成功',
      refund: {
        receiptNumber: refundReceiptNumber,
        totalRefund,
        refundMethod,
        items: refundItems.map(i => ({ name: i.name, quantity: i.quantity, unitPrice: i.unitPrice })),
        originalReceipt: null,
      },
    });
  } catch (err) {
    if (err.code === 11000) {
      return res.status(409).json({ error: '退款小票号重复，请重试', code: 'DUPLICATE_RECEIPT' });
    }
    switch (err.code) {
      case 'ALREADY_REFUNDED':
        return res.status(400).json({ error: '该订单已退款，不可重复退款', code: err.code });
      case 'NOT_FOUND':
        return res.status(404).json({ error: err.message, code: err.code });
      case 'VALIDATION_ERROR':
        return res.status(400).json({ error: err.message, code: err.code });
      case 'ATOMIC_FAILURE':
        return res.status(500).json({ error: '退款处理失败，请重试', code: err.code });
      default:
        console.error('Refund error:', err.message);
        res.status(500).json({ error: '服务器错误' });
    }
  }
});

// ─── GET /api/inv/transactions ──────────────────────────────────────────────
// Transaction list with date range filter and pagination
router.get('/', async (req, res) => {
  try {
    const filter = {};
    const { startDate, endDate, page, limit, q } = req.query;

    // Receipt number search
    if (q && typeof q === 'string' && q.trim()) {
      filter.receiptNumber = { $regex: q.trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), $options: 'i' };
    }

    // Date range filter — parse as local dates to avoid UTC timezone shift
    if (startDate || endDate) {
      filter.createdAt = {};
      if (startDate) {
        const p = startDate.split('-');
        if (p.length === 3) filter.createdAt.$gte = new Date(parseInt(p[0]), parseInt(p[1]) - 1, parseInt(p[2]), 0, 0, 0, 0);
        else filter.createdAt.$gte = new Date(startDate);
      }
      if (endDate) {
        const p = endDate.split('-');
        if (p.length === 3) filter.createdAt.$lte = new Date(parseInt(p[0]), parseInt(p[1]) - 1, parseInt(p[2]), 23, 59, 59, 999);
        else {
          const end = new Date(endDate);
          end.setHours(23, 59, 59, 999);
          filter.createdAt.$lte = end;
        }
      }
    }

    const pageNum = Math.max(1, parseInt(page) || 1);
    const limitNum = Math.min(500, Math.max(1, parseInt(limit) || 20));
    const skip = (pageNum - 1) * limitNum;

    const [transactions, total] = await Promise.all([
      Transaction.find(filter)
        .populate('operator', 'username displayName')
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limitNum),
      Transaction.countDocuments(filter)
    ]);

    res.json({
      data: transactions,
      pagination: {
        page: pageNum,
        limit: limitNum,
        total,
        pages: Math.ceil(total / limitNum)
      }
    });
  } catch (err) {
    res.status(500).json({ error: '服务器错误' });
  }
});

// ─── GET /api/inv/transactions/export ───────────────────────────────────────
// Export transactions as JSON/CSV, mark exported=true
// NOTE: This route must be defined BEFORE /:id to avoid matching 'export' as an id
router.get('/export', async (req, res) => {
  try {
    const { format, startDate, endDate } = req.query;
    const exportFormat = format || 'json';

    if (!['json', 'csv'].includes(exportFormat)) {
      return res.status(400).json({ error: '导出格式无效，支持 json 或 csv', code: 'VALIDATION_ERROR' });
    }

    const filter = {};
    if (startDate || endDate) {
      filter.createdAt = {};
      if (startDate) {
        const p = startDate.split('-');
        if (p.length === 3) filter.createdAt.$gte = new Date(parseInt(p[0]), parseInt(p[1]) - 1, parseInt(p[2]), 0, 0, 0, 0);
        else filter.createdAt.$gte = new Date(startDate);
      }
      if (endDate) {
        const p = endDate.split('-');
        if (p.length === 3) filter.createdAt.$lte = new Date(parseInt(p[0]), parseInt(p[1]) - 1, parseInt(p[2]), 23, 59, 59, 999);
        else {
          const end = new Date(endDate);
          end.setHours(23, 59, 59, 999);
          filter.createdAt.$lte = end;
        }
      }
    }

    const transactions = await Transaction.find(filter)
      .populate('operator', 'username displayName')
      .sort({ createdAt: -1 });

    // Mark exported
    const ids = transactions.map(t => t._id);
    if (ids.length > 0) {
      await Transaction.updateMany({ _id: { $in: ids } }, { $set: { exported: true } });
    }

    if (exportFormat === 'csv') {
      // Generate CSV
      const headers = [
        'receiptNumber', 'totalAmount', 'paymentMethod', 'cardAmount', 'cashReceived',
        'changeGiven', 'standardVatTotal', 'marginVatTotal', 'createdAt',
        'operator', 'itemCount'
      ];
      let csv = headers.join(',') + '\n';
      for (const t of transactions) {
        const row = [
          t.receiptNumber,
          t.totalAmount,
          t.paymentMethod,
          t.cardAmount || '',
          t.cashReceived || '',
          t.changeGiven || '',
          t.standardVatTotal,
          t.marginVatTotal,
          t.createdAt.toISOString(),
          t.operator ? (t.operator.displayName || t.operator.username) : '',
          t.items.length
        ];
        csv += row.map(v => `"${String(v).replace(/"/g, '""')}"`).join(',') + '\n';
      }

      res.setHeader('Content-Type', 'text/csv; charset=utf-8');
      res.setHeader('Content-Disposition', 'attachment; filename=transactions.csv');
      return res.send(csv);
    }

    // JSON format
    res.json({ data: transactions, count: transactions.length });
  } catch (err) {
    res.status(500).json({ error: '服务器错误' });
  }
});

// ─── GET /api/inv/transactions/:id ──────────────────────────────────────────
// Transaction detail
router.get('/:id', async (req, res) => {
  try {
    const transaction = await Transaction.findById(req.params.id)
      .populate('operator', 'username displayName')
      .populate('discountOperator', 'username displayName')
      .populate('items.product', 'name sku category stock');

    if (!transaction) {
      return res.status(404).json({ error: '交易记录不存在' });
    }

    res.json(transaction);
  } catch (err) {
    if (err.name === 'CastError') {
      return res.status(404).json({ error: '交易记录不存在' });
    }
    res.status(500).json({ error: '服务器错误' });
  }
});

// ─── PATCH /api/inv/transactions/:id/edit-items ─────────────────────────────
// Admin only: edit item fields (costPrice, unitPrice) for tax correction
router.patch('/:id/edit-items', requireRole('root'), async (req, res) => {
  try {
    const { updates } = req.body;
    if (!updates || !Array.isArray(updates) || updates.length === 0) {
      return res.status(400).json({ error: 'No updates provided' });
    }

    const transaction = await Transaction.findById(req.params.id);
    if (!transaction) {
      return res.status(404).json({ error: 'Transaction not found' });
    }

    // Apply updates to items
    for (const u of updates) {
      const { idx, field, value } = u;
      if (idx < 0 || idx >= transaction.items.length) continue;
      // Only allow editing specific fields
      if (!['costPrice', 'unitPrice', 'sellingPrice'].includes(field)) continue;
      transaction.items[idx][field] = value;

      // Recalculate subtotal and margin VAT if costPrice or unitPrice changed
      const item = transaction.items[idx];
      const effectivePrice = item.discountedPrice || item.unitPrice || 0;
      item.subtotal = effectivePrice * (item.quantity || 1);

      // Recalculate margin VAT for margin scheme items
      if (item.marginScheme || item.isSecondHand) {
        const margin = effectivePrice - (item.costPrice || 0);
        if (margin > 0) {
          const rate = item.vatRate || 0.23;
          item.marginVat = Math.round((margin / (1 + rate)) * rate * (item.quantity || 1) * 100) / 100;
        } else {
          item.marginVat = 0;
        }
      }
    }

    // Recalculate transaction totals
    let totalAmount = 0;
    let standardVatTotal = 0;
    let marginVatTotal = 0;
    for (const item of transaction.items) {
      totalAmount += item.subtotal || 0;
      standardVatTotal += item.vatAmount || 0;
      marginVatTotal += item.marginVat || 0;
    }
    transaction.totalAmount = Math.round(totalAmount * 100) / 100;
    transaction.standardVatTotal = Math.round(standardVatTotal * 100) / 100;
    transaction.marginVatTotal = Math.round(marginVatTotal * 100) / 100;

    await transaction.save();
    res.json({ success: true, transaction });
  } catch (err) {
    res.status(500).json({ error: '服务器错误' });
  }
});

// ─── DELETE /api/inv/transactions/:id/delete ────────────────────────────────
// Silent delete (Admin only)
router.delete('/:id/delete', requireRole('root'), async (req, res) => {
  try {
    const { confirm } = req.body;

    // Require confirmation
    if (!confirm) {
      return res.status(400).json({ error: '需要确认删除操作（confirm: true）', code: 'VALIDATION_ERROR' });
    }

    const transaction = await Transaction.findById(req.params.id);
    if (!transaction) {
      return res.status(404).json({ error: '交易记录不存在' });
    }

    // Only allow if invoiceGenerated=false
    if (transaction.invoiceGenerated) {
      return res.status(409).json({
        error: '该交易已开发票，不可删除',
        code: 'DELETE_NOT_ALLOWED'
      });
    }

    // Check daily close lock: if the day has been closed AND no monthly report exists, block deletion
    const txnDate = transaction.createdAt instanceof Date
      ? transaction.createdAt.toISOString().split('T')[0]
      : new Date(transaction.createdAt).toISOString().split('T')[0];
    const txnMonth = txnDate.substring(0, 7);
    // Only block deletion if day is CLOSED (confirmed) — PENDING allows deletion for review
    const dayClosed = await DailyClose.findOne({ date: txnDate, status: 'closed' }).select('_id').lean();
    if (dayClosed) {
      const monthReported = await MonthlyReport.findOne({ month: txnMonth }).select('_id').lean();
      if (!monthReported) {
        return res.status(409).json({
          error: `${txnDate} 日结已确认，不可删除。请先生成 ${txnMonth} 月报表`,
          code: 'DAY_CLOSED'
        });
      }
    }

    // Restore product stock for each item
    for (const item of transaction.items) {
      await Product.findByIdAndUpdate(item.product, {
        $inc: { stock: item.quantity },
        updatedAt: new Date()
      });
    }

    // Delete associated StockMovement(exit) records
    await StockMovement.deleteMany({
      referenceId: transaction._id.toString(),
      referenceType: 'transaction',
      type: 'exit'
    });

    // Create AuditLog with encrypted data — DISABLED per requirement: no delete audit log
    // Deletion is permanent, no logging

    // Physically delete the transaction
    await Transaction.findByIdAndDelete(transaction._id);

    res.json({ message: '交易记录已删除' });
  } catch (err) {
    if (err.name === 'CastError') {
      return res.status(404).json({ error: '交易记录不存在' });
    }
    res.status(500).json({ error: '服务器错误' });
  }
});

// ─── DELETE /api/inv/transactions/batch-delete ──────────────────────────────
// Batch delete exported records (Admin only)
router.delete('/batch-delete', requireRole('root'), async (req, res) => {
  try {
    const { ids, confirm } = req.body;

    // Require confirmation
    if (!confirm) {
      return res.status(400).json({ error: '需要确认删除操作（confirm: true）', code: 'VALIDATION_ERROR' });
    }

    if (!ids || !Array.isArray(ids) || ids.length === 0) {
      return res.status(400).json({ error: '缺少要删除的交易ID列表', code: 'VALIDATION_ERROR' });
    }

    // Find all transactions
    const transactions = await Transaction.find({ _id: { $in: ids } });

    if (transactions.length === 0) {
      return res.status(404).json({ error: '未找到指定的交易记录' });
    }

    // Only allow deleting exported and non-invoiced transactions
    const nonExported = transactions.filter(t => !t.exported);
    if (nonExported.length > 0) {
      return res.status(400).json({
        error: `以下交易未导出，不可批量删除: ${nonExported.map(t => t.receiptNumber).join(', ')}`,
        code: 'VALIDATION_ERROR'
      });
    }

    // Block deletion of transactions that already have invoices
    const invoiced = transactions.filter(t => t.invoiceGenerated);
    if (invoiced.length > 0) {
      return res.status(409).json({
        error: `以下交易已开发票，不可删除: ${invoiced.map(t => t.receiptNumber).join(', ')}`,
        code: 'DELETE_NOT_ALLOWED'
      });
    }

    // Check daily close lock for each transaction's date
    const closedLocked = [];
    for (const txn of transactions) {
      const txnDate = txn.createdAt instanceof Date
        ? txn.createdAt.toISOString().split('T')[0]
        : new Date(txn.createdAt).toISOString().split('T')[0];
      const txnMonth = txnDate.substring(0, 7);
      // Only block if CLOSED (confirmed) — PENDING allows deletion for review
      const dayClosed = await DailyClose.findOne({ date: txnDate, status: 'closed' }).select('_id').lean();
      if (dayClosed) {
        const monthReported = await MonthlyReport.findOne({ month: txnMonth }).select('_id').lean();
        if (!monthReported) {
          closedLocked.push(txn.receiptNumber);
        }
      }
    }
    if (closedLocked.length > 0) {
      return res.status(409).json({
        error: `以下交易所在日期已日结且未生成月报表，不可删除: ${closedLocked.join(', ')}。请先生成月报表`,
        code: 'DAY_CLOSED'
      });
    }

    const deletedReceipts = [];

    for (const transaction of transactions) {
      // Restore product stock
      for (const item of transaction.items) {
        await Product.findByIdAndUpdate(item.product, {
          $inc: { stock: item.quantity },
          updatedAt: new Date()
        });
      }

      // Delete associated StockMovement(exit) records
      await StockMovement.deleteMany({
        referenceId: transaction._id.toString(),
        referenceType: 'transaction',
        type: 'exit'
      });

      // AuditLog — DISABLED per requirement: no delete audit log

      deletedReceipts.push(transaction.receiptNumber);
    }

    // Physically delete all transactions
    await Transaction.deleteMany({ _id: { $in: ids } });

    res.json({
      message: `已删除 ${deletedReceipts.length} 条交易记录`,
      deletedReceipts
    });
  } catch (err) {
    if (err.name === 'CastError') {
      return res.status(400).json({ error: '无效的ID格式', code: 'VALIDATION_ERROR' });
    }
    res.status(500).json({ error: '服务器错误' });
  }
});

module.exports = router;
