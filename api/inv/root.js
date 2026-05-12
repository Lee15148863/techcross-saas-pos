/**
 * ROOT CONTROL API — Boss Mobile Dashboard Backend
 *
 * All endpoints are ROOT-only (requireRole('root')).
 * Every action is logged to AuditLog per §8 of RUNBOOK.md.
 * Reuses existing service layer — never bypasses L3 integrity.
 *
 * RUNBOOK §3 Rule D (Atomicity): All financial operations use MongoDB sessions.
 * RUNBOOK §3 Rule E (Audit): Every ROOT action generates AuditLog.
 * SOFT_FREEZE_POLICY §2: Financial core systems are NOT redesigned.
 */

const express = require('express');
const mongoose = require('mongoose');
const { encryptData } = require('../../utils/inv-crypto');
const bcrypt = require('bcryptjs');
const router = express.Router();

const Transaction = require('../../models/inv/Transaction');
const CashLedger = require('../../models/inv/CashLedger');
const { Device } = require('../../models/inv/Device');
const DailyClose = require('../../models/inv/DailyClose');
const InvUser = require('../../models/inv/User');
const AuditLog = require('../../models/inv/AuditLog');
const TrustedDevice = require('../../models/inv/TrustedDevice');
const SystemSetting = require('../../models/inv/SystemSetting');
const SystemState = require('../../models/inv/SystemState');
const StockMovement = require('../../models/inv/StockMovement');

const { jwtAuth, requireRole } = require('../../middleware/inv-auth');
const { authorize, SOURCES } = require('../../utils/inv-integrity-layer');
const { queryTransactions, aggregateTransactions, queryCashLedger, queryDeviceProfitLoss } = require('../../services/inv-query-service');
const { requireSystemActive, getSystemState } = require('../../utils/inv-system-lock');
const { processRefund } = require('../../services/inv-refund-service');
const { closeDay, getDayStatus, listClosedDays } = require('../../services/inv-daily-close-service');
const { AUDIT_ACTIONS, logAdminAction } = require('../../services/inv-admin-service');
const { validatePassword } = require('../../utils/inv-validators');

const BCRYPT_SALT_ROUNDS = 10;

// ─── All routes require ROOT authentication ─────────────────────────
router.use(jwtAuth, requireRole('root'));

// ─── Helper: YYYY-MM-DD date range ──────────────────────────────────
function buildDateFilter(startDate, endDate) {
  const filter = {};
  if (startDate) filter.$gte = new Date(startDate + 'T00:00:00.000Z');
  if (endDate) filter.$lte = new Date(endDate + 'T23:59:59.999Z');
  return Object.keys(filter).length > 0 ? filter : null;
}

// ─── Helper: log ROOT action to AuditLog ────────────────────────────
async function logRootAction({ action, targetType, targetId, details, ip, before, after, role, module, beforeSnapshot, afterSnapshot }) {
  try {
    const auditData = { ...details, timestamp: new Date().toISOString() };
    if (before !== undefined) auditData._before = before;
    if (after !== undefined) auditData._after = after;
    await AuditLog.create({
      action,
      operator: 'root',
      role: role || 'root',
      module: module || null,
      targetType: targetType || 'system',
      targetId: targetId || null,
      encryptedData: encryptData(auditData),
      beforeSnapshot: beforeSnapshot || null,
      afterSnapshot: afterSnapshot || null,
      ip: ip || null,
    });
  } catch (err) {
    console.error('Root audit log failed:', err.message);
  }
}

// ═══════════════════════════════════════════════════════════════════
// FINANCIAL OVERVIEW
// ═══════════════════════════════════════════════════════════════════

// ─── GET /api/root/overview ─────────────────────────────────────────
// Today's financial overview: cash, card, VAT, refunds, device PL
router.get('/overview', async (req, res) => {
  try {
    const today = new Date().toISOString().split('T')[0];
    const dateFilter = buildDateFilter(today, today);

    const [txns, ledgers, devicePL, closedDays] = await Promise.all([
      Transaction.find({ createdAt: dateFilter }).lean(),
      CashLedger.find({ createdAt: dateFilter }).sort({ createdAt: -1 }).lean(),
      queryDeviceProfitLoss({}),
      DailyClose.find({}).sort({ date: -1 }).limit(1).lean(),
    ]);

    const agg = aggregateTransactions(txns);
    const todaySales = txns.filter(t => t.totalAmount > 0);
    const todayRefunds = txns.filter(t => t.totalAmount < 0);

    // Cash ledger totals for the day
    let ledgerCashIn = 0, ledgerCardIn = 0, ledgerCashOut = 0, ledgerCardOut = 0;
    for (const l of ledgers) {
      if (l.direction === 'in') {
        if (l.paymentMethod === 'cash') ledgerCashIn += l.amount;
        else if (l.paymentMethod === 'card') ledgerCardIn += l.amount;
        else if (l.paymentMethod === 'split') {
          ledgerCashIn += l.cashReceived || 0;
          ledgerCardIn += l.cardAmount || 0;
        }
      } else {
        if (l.paymentMethod === 'cash') ledgerCashOut += l.amount;
        else if (l.paymentMethod === 'card') ledgerCardOut += l.amount;
        else if (l.paymentMethod === 'split') {
          ledgerCashOut += l.cashReceived || 0;
          ledgerCardOut += l.cardAmount || 0;
        }
      }
    }

    const lastClose = closedDays.length > 0 ? closedDays[0] : null;

    res.json({
      today: {
        date: today,
        sales: {
          count: todaySales.length,
          gross: agg.summary.grossSales,
          net: agg.summary.netSales,
        },
        refunds: {
          count: todayRefunds.length,
          total: Math.abs(agg.summary.refundTotal),
        },
        payment: agg.payment,
        vat: agg.vat,
        ledger: {
          cashIn: Math.round(ledgerCashIn * 100) / 100,
          cardIn: Math.round(ledgerCardIn * 100) / 100,
          cashOut: Math.round(ledgerCashOut * 100) / 100,
          cardOut: Math.round(ledgerCardOut * 100) / 100,
        },
      },
      devices: {
        totalDevices: devicePL.count,
        soldCount: devicePL.soldCount,
        grossProfit: devicePL.grossProfit,
      },
      lastDailyClose: lastClose ? { date: lastClose.date, status: lastClose.status } : null,
    });
  } catch (err) {
    console.error('Overview error:', err.message);
    res.status(500).json({ error: '服务器错误', code: 'OVERVIEW_ERROR' });
  }
});

// ─── GET /api/root/ledger ───────────────────────────────────────────
// Cash ledger entries with date/type/direction filters
router.get('/ledger', async (req, res) => {
  try {
    const { startDate, endDate, entryType, direction, paymentMethod, limit } = req.query;
    const entryTypes = entryType ? entryType.split(',') : undefined;

    const entries = await queryCashLedger({
      entryTypes,
      direction,
      paymentMethod,
      startDate: startDate || undefined,
      endDate: endDate || undefined,
    });

    const result = limit ? entries.slice(0, parseInt(limit)) : entries;

    // Summary
    let totalIn = 0, totalOut = 0;
    for (const e of result) {
      if (e.direction === 'in') totalIn += e.amount || 0;
      else totalOut += e.amount || 0;
    }

    res.json({
      entries: result,
      summary: {
        totalIn: Math.round(totalIn * 100) / 100,
        totalOut: Math.round(totalOut * 100) / 100,
        net: Math.round((totalIn - totalOut) * 100) / 100,
        count: result.length,
      },
    });
  } catch (err) {
    console.error('Ledger error:', err.message);
    res.status(500).json({ error: '服务器错误', code: 'LEDGER_ERROR' });
  }
});

// ─── GET /api/root/transactions ─────────────────────────────────────
// Transaction list with filters
router.get('/transactions', async (req, res) => {
  try {
    const { types, startDate, endDate, paymentMethod, vatType, limit } = req.query;
    const typeArr = types ? types.split(',') : undefined;

    const txns = await queryTransactions({
      types: typeArr,
      paymentMethod,
      startDate: startDate || undefined,
      endDate: endDate || undefined,
      vatType,
    });

    const result = limit ? txns.slice(0, parseInt(limit)) : txns;
    const agg = aggregateTransactions(result);

    res.json({
      transactions: result,
      summary: agg.summary,
      payment: agg.payment,
      vat: agg.vat,
    });
  } catch (err) {
    console.error('Transactions error:', err.message);
    res.status(500).json({ error: '服务器错误', code: 'TRANSACTIONS_ERROR' });
  }
});

// ═══════════════════════════════════════════════════════════════════
// USER MANAGEMENT
// ═══════════════════════════════════════════════════════════════════

// ─── GET /api/root/users ────────────────────────────────────────────
router.get('/users', async (req, res) => {
  try {
    const users = await InvUser.find({}, '-password').sort({ createdAt: -1 }).lean();
    res.json(users.map(u => ({ ...u, permissions: undefined, _permissions: u.permissions })));
  } catch (err) {
    res.status(500).json({ error: '服务器错误', code: 'USERS_ERROR' });
  }
});

// ─── POST /api/root/users/create ────────────────────────────────────
router.post('/users/create', async (req, res) => {
  try {
    const { username, password, displayName, role } = req.body;
    if (!username || !password || !displayName || !role) {
      return res.status(400).json({ error: '缺少必填字段', code: 'VALIDATION_ERROR' });
    }
    if (!['root', 'manager', 'staff'].includes(role)) {
      return res.status(400).json({ error: '角色无效', code: 'VALIDATION_ERROR' });
    }

    const pwCheck = validatePassword(password);
    if (!pwCheck.valid) {
      return res.status(400).json({ error: pwCheck.error, code: 'VALIDATION_ERROR' });
    }

    const existing = await InvUser.findOne({ username });
    if (existing) {
      return res.status(409).json({ error: '用户名已存在', code: 'DUPLICATE_USERNAME' });
    }

    const hashed = await bcrypt.hash(password, BCRYPT_SALT_ROUNDS);
    const user = await InvUser.create({ username, password: hashed, displayName, role });

    await logRootAction({
      action: 'root.user.create',
      targetType: 'user',
      targetId: user._id.toString(),
      details: { username, displayName, role },
      ip: req.ip,
    });

    res.status(201).json({
      id: user._id, username: user.username, displayName: user.displayName,
      role: user.role, active: user.active, createdAt: user.createdAt,
    });
  } catch (err) {
    if (err.code === 11000) return res.status(409).json({ error: '用户名已存在', code: 'DUPLICATE_USERNAME' });
    console.error('User create error:', err.message);
    res.status(500).json({ error: '服务器错误', code: 'USER_CREATE_ERROR' });
  }
});

// ─── PATCH /api/root/users/:id ──────────────────────────────────────
router.patch('/users/:id', async (req, res) => {
  try {
    const user = await InvUser.findById(req.params.id);
    if (!user) return res.status(404).json({ error: '用户不存在', code: 'NOT_FOUND' });

    const { displayName, role, active, permissions } = req.body;
    const before = { displayName: user.displayName, role: user.role, active: user.active, permissions: user.permissions?.toObject() };

    if (displayName !== undefined) user.displayName = displayName;

    if (role !== undefined) {
      if (!['root', 'manager', 'staff'].includes(role)) {
        return res.status(400).json({ error: '角色无效', code: 'VALIDATION_ERROR' });
      }
      // If changing away from root, ensure at least one other active root remains
      if (user.role === 'root' && role !== 'root') {
        const otherRootCount = await InvUser.countDocuments({
          _id: { $ne: user._id },
          role: 'root',
          active: true,
        });
        if (otherRootCount < 1) {
          return res.status(409).json({
            error: '系统必须至少保留一个 Root 权限的用户',
            code: 'LAST_ROOT'
          });
        }
      }
      user.role = role;
    }

    if (active !== undefined) {
      // If deactivating a root user, ensure at least one other active root remains
      if (active === false && user.role === 'root') {
        const otherRootCount = await InvUser.countDocuments({
          _id: { $ne: user._id },
          role: 'root',
          active: true,
        });
        if (otherRootCount < 1) {
          return res.status(409).json({
            error: '系统必须至少保留一个 Root 权限的用户',
            code: 'LAST_ROOT'
          });
        }
      }
      user.active = active;
    }

    // Update permissions (only meaningful for staff role)
    if (permissions !== undefined && typeof permissions === 'object') {
      if (!user.permissions) {
        user.permissions = {};
      }
      for (const key of InvUser.PERMISSION_KEYS) {
        if (permissions[key] !== undefined) {
          user.permissions[key] = !!permissions[key];
        }
      }
    }

    user.updatedAt = new Date();
    await user.save();

    await logRootAction({
      action: 'root.user.update',
      targetType: 'user',
      targetId: user._id.toString(),
      details: { changes: req.body },
      before, after: { displayName: user.displayName, role: user.role, active: user.active },
      ip: req.ip,
    });

    res.json({
      id: user._id, username: user.username, displayName: user.displayName,
      role: user.role, active: user.active, permissions: user.getPermissions(),
    });
  } catch (err) {
    if (err.code === 'LAST_ROOT') throw err;
    if (err.name === 'CastError') return res.status(404).json({ error: '用户不存在', code: 'NOT_FOUND' });
    console.error('User update error:', err.message);
    res.status(500).json({ error: '服务器错误', code: 'USER_UPDATE_ERROR' });
  }
});

// ─── DELETE /api/root/users/:id ─────────────────────────────────────
router.delete('/users/:id', async (req, res) => {
  try {
    if (req.params.id === req.user.userId) {
      return res.status(400).json({ error: '不能删除自己的账号', code: 'SELF_DELETE' });
    }

    const user = await InvUser.findById(req.params.id);
    if (!user) return res.status(404).json({ error: '用户不存在', code: 'NOT_FOUND' });

    // SYSTEM ROOT LOCK: cannot delete SYSTEM_ROOTS
    if (InvUser.SYSTEM_ROOTS && InvUser.SYSTEM_ROOTS.includes(user.username)) {
      return res.status(403).json({ error: '系统根用户不可删除', code: 'SYSTEM_ROOT_PROTECTED' });
    }

    // Cannot delete the last active root
    if (user.role === 'root') {
      const otherRootCount = await InvUser.countDocuments({
        _id: { $ne: user._id },
        role: 'root',
        active: true,
      });
      if (otherRootCount < 1) {
        return res.status(409).json({
          error: '系统必须至少保留一个 Root 权限的用户',
          code: 'LAST_ROOT'
        });
      }
    }

    // Soft-delete: disable instead of removing if user has transactions
    const hasTxns = await Transaction.findOne({ operator: req.params.id });
    if (hasTxns) {
      user.active = false;
      user.updatedAt = new Date();
      await user.save();

      await logRootAction({
        action: 'root.user.disable',
        targetType: 'user',
        targetId: req.params.id,
        details: { username: user.username, reason: 'has_transactions' },
        ip: req.ip,
      });

      return res.json({ message: '用户已有交易记录，已停用账号', disabled: true });
    }

    await InvUser.findByIdAndDelete(req.params.id);

    await logRootAction({
      action: 'root.user.delete',
      targetType: 'user',
      targetId: req.params.id,
      details: { username: user.username },
      ip: req.ip,
    });

    res.json({ message: '用户已删除', deleted: true });
  } catch (err) {
    if (err.code === 'LAST_ROOT') throw err;
    if (err.name === 'CastError') return res.status(404).json({ error: '用户不存在', code: 'NOT_FOUND' });
    console.error('User delete error:', err.message);
    res.status(500).json({ error: '服务器错误', code: 'USER_DELETE_ERROR' });
  }
});

// ─── POST /api/root/users/:id/reset-password ─────────────────────────
// Root can reset any user's password (including creating another root)
router.post('/users/:id/reset-password', async (req, res) => {
  try {
    const { password } = req.body;
    if (!password) {
      return res.status(400).json({ error: '新密码不能为空', code: 'VALIDATION_ERROR' });
    }

    const pwCheck = validatePassword(password);
    if (!pwCheck.valid) {
      return res.status(400).json({ error: pwCheck.error, code: 'VALIDATION_ERROR' });
    }

    const user = await InvUser.findById(req.params.id);
    if (!user) {
      return res.status(404).json({ error: '用户不存在', code: 'NOT_FOUND' });
    }

    // Prevent locking system root out
    if (InvUser.SYSTEM_ROOTS.includes(user.username) && req.params.id === req.user.userId) {
      // Allow resetting own password — this is fine
    }

    const hashedPassword = await bcrypt.hash(password, BCRYPT_SALT_ROUNDS);
    user.password = hashedPassword;
    user.failedAttempts = 0;
    user.lockedUntil = null;
    user.updatedAt = new Date();
    await user.save();

    await logRootAction({
      action: 'root.user.password_reset',
      targetType: 'user',
      targetId: user._id.toString(),
      details: { username: user.username },
      ip: req.ip,
    });

    res.json({ message: '密码重置成功' });
  } catch (err) {
    if (err.name === 'CastError') return res.status(404).json({ error: '用户不存在', code: 'NOT_FOUND' });
    console.error('Password reset error:', err.message);
    res.status(500).json({ error: '服务器错误', code: 'PASSWORD_RESET_ERROR' });
  }
});

// ═══════════════════════════════════════════════════════════════════
// REFUND CONTROL
// ═══════════════════════════════════════════════════════════════════

// ─── POST /api/root/refund/force ────────────────────────────────────
// Force a refund through the service layer (uses processRefund)
router.post('/refund/force', async (req, res) => {
  try {
    await requireSystemActive();
    const { receiptNumber, refundMethod, items, reason } = req.body;
    if (!receiptNumber || !refundMethod) {
      return res.status(400).json({ error: '缺少必填字段', code: 'VALIDATION_ERROR' });
    }

    const result = await processRefund({
      receiptNumber,
      refundMethod,
      items: items || undefined,
      reason: reason || 'Root forced refund',
      operator: req.user.userId,
    });

    await logRootAction({
      action: 'root.refund.force',
      targetType: 'transaction',
      targetId: result.transaction._id.toString(),
      details: { receiptNumber, refundMethod, totalRefund: result.totalRefund, originalReceipt: receiptNumber },
      ip: req.ip,
    });

    res.json({
      success: true,
      transaction: result.transaction,
      totalRefund: result.totalRefund,
      refundMethod,
    });
  } catch (err) {
    if (err.code) {
      return res.status(409).json({ error: err.message, code: err.code });
    }
    console.error('Force refund error:', err.message);
    res.status(500).json({ error: '退款处理失败', code: 'REFUND_ERROR' });
  }
});

// ─── POST /api/root/refund/reverse ─────────────────────────────────
// Reverse a refund transaction (Root override — creates compensating entry)
router.post('/refund/reverse', async (req, res) => {
  try {
    await requireSystemActive();
    const { receiptNumber, reason } = req.body;
    if (!receiptNumber) {
      return res.status(400).json({ error: '缺少退款交易编号', code: 'VALIDATION_ERROR' });
    }

    // Find the refund transaction
    const refundTxn = await Transaction.findOne({ receiptNumber });
    if (!refundTxn) {
      return res.status(404).json({ error: '交易不存在', code: 'NOT_FOUND' });
    }
    if (refundTxn.totalAmount >= 0) {
      return res.status(400).json({ error: '该交易不是退款交易', code: 'NOT_A_REFUND' });
    }

    // Find original sale
    const originalReceipt = refundTxn.originalReceipt;
    if (!originalReceipt) {
      return res.status(400).json({ error: '无法确定原始交易', code: 'NO_ORIGINAL' });
    }

    // Re-process refund on the original (creates a compensating refund
    // that puts money back into the system)
    const result = await processRefund({
      receiptNumber: originalReceipt,
      refundMethod: refundTxn.paymentMethod,
      reason: reason || `Reverse refund ${receiptNumber} — Root action`,
      operator: req.user.userId,
    });

    await logRootAction({
      action: 'root.refund.reverse',
      targetType: 'transaction',
      targetId: result.transaction._id.toString(),
      details: { reversedRefund: receiptNumber, originalReceipt, totalRefund: result.totalRefund },
      ip: req.ip,
    });

    res.json({
      success: true,
      reversalTransaction: result.transaction,
      originalRefundReceipt: receiptNumber,
      originalSaleReceipt: originalReceipt,
    });
  } catch (err) {
    if (err.code === 'ALREADY_REFUNDED') {
      return res.status(409).json({ error: '该交易已被逆转', code: 'ALREADY_REVERSED' });
    }
    console.error('Reverse refund error:', err.message);
    res.status(500).json({ error: '逆转退款失败', code: 'REVERSE_ERROR' });
  }
});

// ─── GET /api/root/refund/history ───────────────────────────────────
// Refund history
router.get('/refund/history', async (req, res) => {
  try {
    const { startDate, endDate, limit } = req.query;
    const dateFilter = buildDateFilter(startDate, endDate);

    const match = { totalAmount: { $lt: 0 } };
    if (dateFilter) match.createdAt = dateFilter;

    let refunds = await Transaction.find(match)
      .sort({ createdAt: -1 })
      .lean();

    if (limit) refunds = refunds.slice(0, parseInt(limit));

    const total = refunds.reduce((s, t) => s + Math.abs(t.totalAmount || 0), 0);

    res.json({
      refunds,
      summary: { count: refunds.length, total: Math.round(total * 100) / 100 },
    });
  } catch (err) {
    console.error('Refund history error:', err.message);
    res.status(500).json({ error: '服务器错误', code: 'REFUND_HISTORY_ERROR' });
  }
});

// ═══════════════════════════════════════════════════════════════════
// DEVICE CONTROL
// ═══════════════════════════════════════════════════════════════════

// ─── GET /api/root/devices ─────────────────────────────────────────
router.get('/devices', async (req, res) => {
  try {
    const { status, startDate, endDate, limit } = req.query;

    let result;
    if (status === 'SOLD') {
      result = await queryDeviceProfitLoss({ startDate, endDate });
    } else {
      const match = {};
      if (status) match.status = status;
      const sd = startDate ? new Date(startDate + 'T00:00:00.000Z') : null;
      const ed = endDate ? new Date(endDate + 'T23:59:59.999Z') : null;
      if (sd || ed) {
        match.createdAt = {};
        if (sd) match.createdAt.$gte = sd;
        if (ed) match.createdAt.$lte = ed;
      }

      const devices = await Device.find(match).sort({ createdAt: -1 }).lean();
      result = {
        totalBuyPrice: devices.reduce((s, d) => s + (d.buyPrice || 0), 0),
        count: devices.length,
        devices: devices.map(d => ({
          serialNumber: d.serialNumber,
          status: d.status,
          buyPrice: d.buyPrice || 0,
          sellPrice: d.sellPrice || 0,
          profit: Math.round(((d.sellPrice || 0) - (d.buyPrice || 0)) * 100) / 100,
          product: d.product,
          source: d.source,
          model: d.model,
          notes: d.notes,
          createdAt: d.createdAt,
        })),
      };
    }

    if (limit && result.devices) {
      result.devices = result.devices.slice(0, parseInt(limit));
    }

    res.json(result);
  } catch (err) {
    console.error('Devices error:', err.message);
    res.status(500).json({ error: '服务器错误', code: 'DEVICES_ERROR' });
  }
});

// ─── PATCH /api/root/devices/:id ────────────────────────────────────
// Root override for device fields (uses SOURCES.ROOT_EDIT)
router.patch('/devices/:id', async (req, res) => {
  try {
    const device = await Device.findById(req.params.id);
    if (!device) return res.status(404).json({ error: '设备不存在', code: 'NOT_FOUND' });

    const allowedFields = ['buyPrice', 'sellPrice', 'status', 'source', 'notes', 'model'];
    const before = {};
    const changes = {};

    for (const field of allowedFields) {
      if (req.body[field] !== undefined) {
        before[field] = device[field];
        device[field] = req.body[field];
        changes[field] = req.body[field];
      }
    }

    if (Object.keys(changes).length === 0) {
      return res.status(400).json({ error: '没有可更新的字段', code: 'VALIDATION_ERROR' });
    }

    device.updatedAt = new Date();
    authorize(device, SOURCES.ROOT_EDIT);
    await device.save();

    await logRootAction({
      action: 'root.device.update',
      targetType: 'device',
      targetId: device._id.toString(),
      details: { serialNumber: device.serialNumber, changes },
      before, after: changes,
      ip: req.ip,
    });

    res.json({
      id: device._id,
      serialNumber: device.serialNumber,
      status: device.status,
      buyPrice: device.buyPrice,
      sellPrice: device.sellPrice,
      source: device.source,
      notes: device.notes,
      model: device.model,
    });
  } catch (err) {
    if (err.name === 'CastError') return res.status(404).json({ error: '设备不存在', code: 'NOT_FOUND' });
    console.error('Device update error:', err.message);
    res.status(500).json({ error: '设备更新失败', code: 'DEVICE_UPDATE_ERROR' });
  }
});

// ═══════════════════════════════════════════════════════════════════
// DAILY CLOSE CONTROL
// ═══════════════════════════════════════════════════════════════════

// ─── GET /api/root/daily-close/status ──────────────────────────────
router.get('/daily-close/status', async (req, res) => {
  try {
    const { date } = req.query;
    if (date) {
      const status = await getDayStatus(date);
      return res.json(status);
    }

    // No date: return today + last 7 days
    const today = new Date().toISOString().split('T')[0];
    const statuses = [];
    for (let i = 0; i < 7; i++) {
      const d = new Date();
      d.setDate(d.getDate() - i);
      const ds = d.toISOString().split('T')[0];
      const s = await getDayStatus(ds);
      statuses.push(s);
    }

    res.json({ days: statuses });
  } catch (err) {
    console.error('Daily close status error:', err.message);
    res.status(500).json({ error: '服务器错误', code: 'CLOSE_STATUS_ERROR' });
  }
});

// ─── POST /api/root/daily-close/force ──────────────────────────────
// Force daily close with override on validation warnings
router.post('/daily-close/force', async (req, res) => {
  try {
    await requireSystemActive();
    const { date, skipDevicePL } = req.body;
    if (!date) {
      return res.status(400).json({ error: '缺少日期参数', code: 'VALIDATION_ERROR' });
    }

    const result = await closeDay(date, req.user.userId, {
      skipDevicePL: !!skipDevicePL,
      force: true,
    });

    await logRootAction({
      action: 'root.dailyclose.force',
      targetType: 'dailyclose',
      targetId: date,
      details: { date, validation: result.validation },
      ip: req.ip,
    });

    res.json({
      message: '日结强制完成',
      date,
      status: 'closed',
      snapshot: result.snapshot,
      validation: result.validation,
    });
  } catch (err) {
    if (err.code === 'ALREADY_CLOSED') {
      return res.status(409).json({ error: '该日期已经日结', code: err.code });
    }
    console.error('Force close error:', err.message);
    res.status(500).json({ error: '强制日结失败', code: 'FORCE_CLOSE_ERROR' });
  }
});

// ─── POST /api/root/daily-close/reopen ─────────────────────────────
// Reopen a closed day (Root override with full audit)
router.post('/daily-close/reopen', async (req, res) => {
  try {
    await requireSystemActive();
    const { date, reason } = req.body;
    if (!date) {
      return res.status(400).json({ error: '缺少日期参数', code: 'VALIDATION_ERROR' });
    }

    const doc = await DailyClose.findOne({ date });
    if (!doc) {
      return res.status(404).json({ error: '该日期无日结记录', code: 'NOT_FOUND' });
    }
    if (doc.status !== 'closed') {
      return res.status(400).json({ error: '该日期未处于已关闭状态', code: 'NOT_CLOSED' });
    }

    const before = doc.toObject();
    doc.status = 'open';
    doc.updatedAt = new Date();
    doc.updatedBy = req.user.userId;
    // Mark with root override to bypass immutability check
    authorize(doc, SOURCES.ROOT_EDIT);
    await doc.save();

    await logRootAction({
      action: 'root.dailyclose.reopen',
      targetType: 'dailyclose',
      targetId: date,
      details: { date, reason: reason || 'Root reopen' },
      before: { status: before.status },
      after: { status: 'open' },
      ip: req.ip,
    });

    res.json({ message: '日结已重新打开', date, status: 'open' });
  } catch (err) {
    if (err.message?.includes('INTEGRITY') || err.message?.includes('immutable')) {
      return res.status(403).json({ error: '日结记录不可修改，需要更高权限覆盖', code: 'IMMUTABLE' });
    }
    console.error('Reopen error:', err.message);
    res.status(500).json({ error: '重新打开日结失败', code: 'REOPEN_ERROR' });
  }
});

// ═══════════════════════════════════════════════════════════════════
// SYSTEM CONTROL — Emergency Lock System
// ═══════════════════════════════════════════════════════════════════
//
// RUNBOOK §3 Rule A: No frontend bypass of system state.
// SOFT_FREEZE_POLICY §2: Financial core frozen — safety checks only.
//
// Three states:
//   ACTIVE — Normal operations
//   PAUSED — POS blocked, read-only queries allowed
//   LOCKED — All financial operations blocked (strongest lockdown)
//
// Only root can transition between states.
// SystemState is the SINGLE SOURCE OF TRUTH for system status.

// ─── POST /api/root/system/lock ────────────────────────────────────
// Full system lock — blocks ALL financial operations.
// Sets SystemState to LOCKED. Even ROOT cannot bypass without unlock.
router.post('/system/lock', async (req, res) => {
  try {
    const { reason } = req.body;
    const before = await getSystemState();
    await SystemState.findByIdAndUpdate('global', {
      status: 'LOCKED',
      reason: reason || 'Emergency lock — all financial operations blocked',
      triggeredBy: req.user.userId,
      timestamp: new Date(),
    }, { upsert: true });
    await logRootAction({
      action: 'root.system.lock', module: 'system', role: 'root',
      targetType: 'system', targetId: 'system_lock',
      details: { reason: reason || 'Emergency lock' },
      beforeSnapshot: { status: before.status },
      afterSnapshot: { status: 'LOCKED' },
      ip: req.ip,
    });
    res.json({ message: 'System LOCKED — all financial operations blocked', status: 'LOCKED' });
  } catch (err) {
    console.error('System lock error:', err.message);
    res.status(500).json({ error: 'System lock failed', code: 'LOCK_ERROR' });
  }
});

// ─── POST /api/root/system/unlock ──────────────────────────────────
// ONLY way to unblock — sets SystemState to ACTIVE.
// Root override with full audit trail.
router.post('/system/unlock', async (req, res) => {
  try {
    const { reason } = req.body;
    const before = await getSystemState();
    await SystemState.findByIdAndUpdate('global', {
      status: 'ACTIVE',
      reason: reason || 'Root unlock — normal operations restored',
      triggeredBy: req.user.userId,
      timestamp: new Date(),
    }, { upsert: true });
    await logRootAction({
      action: 'root.system.unlock', module: 'system', role: 'root',
      targetType: 'system', targetId: 'system_unlock',
      details: { reason: reason || 'Root unlock' },
      beforeSnapshot: { status: before.status },
      afterSnapshot: { status: 'ACTIVE' },
      ip: req.ip,
    });
    res.json({ message: 'System UNLOCKED — normal operations restored', status: 'ACTIVE' });
  } catch (err) {
    console.error('System unlock error:', err.message);
    res.status(500).json({ error: 'System unlock failed', code: 'UNLOCK_ERROR' });
  }
});

// ─── POST /api/root/system/pause ───────────────────────────────────
// Soft pause — POS blocked, read-only queries allowed.
router.post('/system/pause', async (req, res) => {
  try {
    const { reason } = req.body;
    const before = await getSystemState();
    await SystemState.findByIdAndUpdate('global', {
      status: 'PAUSED',
      reason: reason || 'System paused by root',
      triggeredBy: req.user.userId,
      timestamp: new Date(),
    }, { upsert: true });
    await logRootAction({
      action: 'root.system.pause', module: 'system', role: 'root',
      targetType: 'system', targetId: 'system_pause',
      details: { reason: reason || 'System pause' },
      beforeSnapshot: { status: before.status },
      afterSnapshot: { status: 'PAUSED' },
      ip: req.ip,
    });
    res.json({ message: 'System PAUSED — POS operations blocked', status: 'PAUSED' });
  } catch (err) {
    console.error('System pause error:', err.message);
    res.status(500).json({ error: 'System pause failed', code: 'PAUSE_ERROR' });
  }
});

// ─── POST /api/root/system/resume ──────────────────────────────────
// Resume normal operations (sets ACTIVE from PAUSED only).
// If currently LOCKED, use /system/unlock instead.
router.post('/system/resume', async (req, res) => {
  try {
    const { reason } = req.body;
    const before = await getSystemState();
    if (before.status === 'LOCKED') {
      return res.status(400).json({
        error: 'System is LOCKED. Use /system/unlock to restore operations.',
        code: 'SYSTEM_LOCKED',
      });
    }
    await SystemState.findByIdAndUpdate('global', {
      status: 'ACTIVE',
      reason: reason || 'System resumed by root',
      triggeredBy: req.user.userId,
      timestamp: new Date(),
    }, { upsert: true });
    await logRootAction({
      action: 'root.system.resume', module: 'system', role: 'root',
      targetType: 'system', targetId: 'system_resume',
      details: { reason: reason || 'System resume' },
      beforeSnapshot: { status: before.status },
      afterSnapshot: { status: 'ACTIVE' },
      ip: req.ip,
    });
    res.json({ message: 'System RESUMED — normal operations restored', status: 'ACTIVE' });
  } catch (err) {
    console.error('System resume error:', err.message);
    res.status(500).json({ error: 'System resume failed', code: 'RESUME_ERROR' });
  }
});

// ─── POST /api/root/system/lock-all-transactions ───────────────────
// Historical transaction immutability lock
router.post('/system/lock-all-transactions', async (req, res) => {
  try {
    await SystemSetting.findOneAndUpdate(
      { key: 'transactions_locked' },
      { key: 'transactions_locked', value: true, updatedBy: req.user.userId, updatedAt: new Date() },
      { upsert: true }
    );
    await logRootAction({
      action: 'root.system.lock_transactions', module: 'system', role: 'root',
      targetType: 'system',
      targetId: 'transactions_lock',
      details: { locked: true },
      ip: req.ip,
    });
    res.json({ message: 'All transactions locked', locked: true });
  } catch (err) {
    console.error('Lock transactions error:', err.message);
    res.status(500).json({ error: 'Lock failed', code: 'LOCK_ERROR' });
  }
});

// ─── GET /api/root/system/status ───────────────────────────────────
// Full system state from SystemState singleton
router.get('/system/status', async (req, res) => {
  try {
    const [state, lastClose, userCount] = await Promise.all([
      getSystemState(),
      DailyClose.findOne({}).sort({ date: -1 }).lean(),
      InvUser.countDocuments({ active: true }),
    ]);

    res.json({
      status: state.status,
      reason: state.reason || '',
      ...(state.triggeredBy ? { triggeredBy: state.triggeredBy } : {}),
      ...(state.timestamp ? { lockTimestamp: state.timestamp } : {}),
      systemPaused: state.status === 'PAUSED',
      systemLocked: state.status === 'LOCKED',
      transactionsLocked: false, // kept for backwards compat
      lastDailyClose: lastClose ? { date: lastClose.date, status: lastClose.status } : null,
      activeUsers: userCount,
      serverTime: new Date().toISOString(),
    });
  } catch (err) {
    console.error('System status error:', err.message);
    res.status(500).json({ error: 'Server error', code: 'STATUS_ERROR' });
  }
});

// ─── GET /api/root/audit-log ──────────────────────────────────────
// Rich audit log with filters + cursor pagination
router.get('/audit-log', async (req, res) => {
  try {
    const { startDate, endDate, userId, actionType, module, limit, cursor } = req.query;
    const filter = { action: /^root\./ };

    if (actionType) filter.action = actionType;
    if (module) filter.module = module;
    if (userId) filter.operator = userId;
    if (startDate || endDate) {
      filter.createdAt = {};
      if (startDate) filter.createdAt.$gte = new Date(startDate + 'T00:00:00.000Z');
      if (endDate) filter.createdAt.$lte = new Date(endDate + 'T23:59:59.999Z');
    }
    if (cursor) filter._id = { $lt: cursor };

    const pageSize = Math.min(parseInt(limit) || 50, 200);
    const logs = await AuditLog.find(filter)
      .sort({ _id: -1 })
      .limit(pageSize + 1)
      .populate('operator', 'username displayName role')
      .lean();

    const hasMore = logs.length > pageSize;
    if (hasMore) logs.pop();
    const nextCursor = logs.length > 0 ? logs[logs.length - 1]._id : null;

    res.json({
      logs,
      count: logs.length,
      pagination: {
        nextCursor: hasMore ? nextCursor : null,
        hasMore,
        pageSize,
      },
    });
  } catch (err) {
    console.error('Audit log error:', err.message);
    res.status(500).json({ error: 'Server error', code: 'AUDIT_LOG_ERROR' });
  }
});

// ═══════════════════════════════════════════════════════════════════
// TRUSTED DEVICE MANAGEMENT
// ═══════════════════════════════════════════════════════════════════

// ─── GET /api/root/devices/trusted ───────────────────────────────
// List all trusted devices across all users
router.get('/devices/trusted', async (req, res) => {
  try {
    const devices = await TrustedDevice.find({})
      .populate('userId', 'username displayName role')
      .sort({ lastUsedAt: -1 })
      .lean();

    res.json({
      devices: devices.map(d => ({
        id: d._id,
        userId: d.userId?._id,
        username: d.userId?.username || 'unknown',
        displayName: d.userId?.displayName || '',
        deviceId: d.deviceId,
        deviceName: d.deviceName || '',
        trusted: d.trusted,
        trustLevel: d.trustLevel,
        revoked: d.revoked,
        firstSeenAt: d.firstSeenAt,
        lastUsedAt: d.lastUsedAt,
        failedAttempts: d.failedAttempts || 0,
      })),
      count: devices.length,
    });
  } catch (err) {
    console.error('Trusted devices list error:', err.message);
    res.status(500).json({ error: '服务器错误', code: 'DEVICES_ERROR' });
  }
});

// ─── POST /api/root/devices/trusted/revoke ───────────────────────
// Revoke a trusted device by deviceId
router.post('/devices/trusted/revoke', async (req, res) => {
  try {
    const { deviceId } = req.body;
    if (!deviceId) {
      return res.status(400).json({ error: '缺少设备ID', code: 'VALIDATION_ERROR' });
    }

    const device = await TrustedDevice.findOne({ deviceId });
    if (!device) {
      return res.status(404).json({ error: '设备未找到', code: 'NOT_FOUND' });
    }

    const before = { trusted: device.trusted, revoked: device.revoked, trustLevel: device.trustLevel };
    device.trusted = false;
    device.revoked = true;
    device.trustLevel = 'untrusted';
    await device.save();

    await logRootAction({
      action: 'root.device.revoke',
      targetType: 'device',
      targetId: device._id.toString(),
      details: { deviceId, deviceName: device.deviceName },
      before, after: { trusted: false, revoked: true, trustLevel: 'untrusted' },
      ip: req.ip,
    });

    res.json({ message: '设备已撤销信任', deviceId });
  } catch (err) {
    console.error('Device revoke error:', err.message);
    res.status(500).json({ error: '服务器错误', code: 'REVOKE_ERROR' });
  }
});

// ─── DELETE /api/root/devices/trusted/:id ─────────────────────────
// Remove a trusted device record entirely
router.delete('/devices/trusted/:id', async (req, res) => {
  try {
    const device = await TrustedDevice.findById(req.params.id);
    if (!device) {
      return res.status(404).json({ error: '设备未找到', code: 'NOT_FOUND' });
    }

    const details = { deviceId: device.deviceId, deviceName: device.deviceName };
    await TrustedDevice.findByIdAndDelete(req.params.id);

    await logRootAction({
      action: 'root.device.delete',
      targetType: 'device',
      targetId: req.params.id,
      details,
      ip: req.ip,
    });

    res.json({ message: '设备记录已删除' });
  } catch (err) {
    if (err.name === 'CastError') return res.status(404).json({ error: '设备未找到', code: 'NOT_FOUND' });
    console.error('Device delete error:', err.message);
    res.status(500).json({ error: '服务器错误', code: 'DELETE_ERROR' });
  }
});

module.exports = router;
