const express = require('express');
const router = express.Router();
const { encryptData } = require('../../utils/inv-crypto');
const SystemSetting = require('../../models/inv/SystemSetting');
const AuditLog = require('../../models/inv/AuditLog');
const { jwtAuth, requireRole, requirePermission } = require('../../middleware/inv-auth');
const { AUDIT_ACTIONS, logAdminAction } = require('../../services/inv-admin-service');

// ─── Default settings ───────────────────────────────────────────────────────
const DEFAULT_SETTINGS = {
  vatRate: 0.23,
  lowStockDefaults: { phone: 10, accessory: 30, tablet: 5 },
  companyInfo: {
    name: process.env.COMPANY_NAME || 'TechCross Repair Centre',
    address: process.env.COMPANY_ADDRESS || 'UNIT M.4, Navan Town Centre, Kennedy Road, Navan, Co. Meath, C15 F658',
    phone: process.env.COMPANY_PHONE || '046 905 9854',
    vatNumber: process.env.VAT_NUMBER || 'IE3330982OH',
    logo: ''
  },
  // Device rules
  deviceDefaultSource: 'customer',
  deviceDefaultBuyPrice: 0,
  deviceRequireTesting: true,
  // Receipt settings
  receiptHeader: '',
  receiptFooter: 'Thank you for your business!',
  receiptShowVat: true,
  receiptShowBarcode: false,
  receiptShowSerialNumbers: true,
};

// ─── Helper: load all settings merged with defaults ─────────────────────────
async function loadSettings() {
  const docs = await SystemSetting.find({});
  const settings = { ...DEFAULT_SETTINGS };
  for (const doc of docs) {
    settings[doc.key] = doc.value;
  }
  return settings;
}

// ─── GET /api/inv/settings ──────────────────────────────────────────────────
// Get all system settings (Staff+ access)
router.get('/', jwtAuth, requireRole('root', 'manager', 'staff'), async (req, res) => {
  try {
    const settings = await loadSettings();
    res.json(settings);
  } catch (err) {
    res.status(500).json({ error: '服务器错误' });
  }
});

// ─── GET /api/inv/settings/audit-log ────────────────────────────────────────
// View audit log (Root only)
router.get('/audit-log', jwtAuth, requireRole('root'), async (req, res) => {
  try {
    const page = Math.max(1, parseInt(req.query.page) || 1);
    const limit = Math.min(100, Math.max(1, parseInt(req.query.limit) || 20));
    const skip = (page - 1) * limit;
    const { action, targetType } = req.query;

    const filter = {};
    if (action) filter.action = action;
    if (targetType) filter.targetType = targetType;

    const [logs, total] = await Promise.all([
      AuditLog.find(filter)
        .populate('operator', 'username displayName')
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit),
      AuditLog.countDocuments(filter)
    ]);

    res.json({
      data: logs,
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

// ─── PUT /api/inv/settings ──────────────────────────────────────────────────
// Update system settings (Root only)
// VAT rate changes are audit-logged automatically.
router.put('/', jwtAuth, requireRole('root'), async (req, res) => {
  try {
    const { key, value, settings } = req.body;

    // Bulk update mode: { settings: { vatRate: 0.23, companyInfo: {...} } }
    if (settings && typeof settings === 'object') {
      const results = {};
      for (const [k, v] of Object.entries(settings)) {
        // Block attempts to set invalid vatRate
        if (k === 'vatRate' && (typeof v !== 'number' || v < 0 || v > 1)) {
          return res.status(400).json({ error: `无效的 VAT 税率: ${v}`, code: 'VALIDATION_ERROR' });
        }

        const doc = await SystemSetting.findOneAndUpdate(
          { key: k },
          { key: k, value: v, updatedBy: req.user.userId, updatedAt: new Date() },
          { upsert: true, new: true }
        );
        results[k] = doc.value;

        // Audit log for all setting changes
        logAdminAction({
          action: k === 'vatRate' ? AUDIT_ACTIONS.VAT_RATE_CHANGE : AUDIT_ACTIONS.SETTING_CHANGE,
          operator: req.user.userId,
          targetType: 'setting',
          targetId: k,
          details: { key: k, newValue: v },
          ip: req.ip || req.connection?.remoteAddress,
        });
      }
      return res.json(results);
    }

    // Single update mode: { key: 'vatRate', value: 0.23 }
    if (!key || typeof key !== 'string' || key.trim() === '') {
      return res.status(400).json({ error: '缺少设置键名（key）', code: 'VALIDATION_ERROR' });
    }

    if (value === undefined || value === null) {
      return res.status(400).json({ error: '缺少设置值（value）', code: 'VALIDATION_ERROR' });
    }

    // Validate vatRate range
    if (key.trim() === 'vatRate' && (typeof value !== 'number' || value < 0 || value > 1)) {
      return res.status(400).json({ error: `无效的 VAT 税率: ${value}`, code: 'VALIDATION_ERROR' });
    }

    const doc = await SystemSetting.findOneAndUpdate(
      { key: key.trim() },
      { key: key.trim(), value, updatedBy: req.user.userId, updatedAt: new Date() },
      { upsert: true, new: true }
    );

    logAdminAction({
      action: key.trim() === 'vatRate' ? AUDIT_ACTIONS.VAT_RATE_CHANGE : AUDIT_ACTIONS.SETTING_CHANGE,
      operator: req.user.userId,
      targetType: 'setting',
      targetId: key.trim(),
      details: { key: key.trim(), newValue: value },
      ip: req.ip || req.connection?.remoteAddress,
    });

    res.json({ key: doc.key, value: doc.value });
  } catch (err) {
    if (err.name === 'ValidationError') {
      const messages = Object.values(err.errors).map(e => e.message);
      return res.status(400).json({ error: messages.join('；') });
    }
    res.status(500).json({ error: '服务器错误' });
  }
});

// ─── GET /api/inv/settings/website ──────────────────────────────────────────
// Get website content settings (requires website permission)
router.get('/website', jwtAuth, requirePermission('website'), async (req, res) => {
  try {
    const docs = await SystemSetting.find({ key: /^website_/ });
    const website = {
      storeStatus: 'open',
      businessHours: 'Mon-Sat 10:00-18:00',
      announcement: '',
      socialMedia: { facebook: '', whatsapp: '', instagram: '' },
      storeDescription: '',
    };
    for (const doc of docs) {
      website[doc.key.replace('website_', '')] = doc.value;
    }
    res.json(website);
  } catch (err) {
    res.status(500).json({ error: '服务器错误' });
  }
});

// ─── PUT /api/inv/settings/website ──────────────────────────────────────────
// Update website content settings (requires website permission)
router.put('/website', jwtAuth, requirePermission('website'), async (req, res) => {
  try {
    const { settings } = req.body;

    if (!settings || typeof settings !== 'object') {
      return res.status(400).json({ error: '缺少 website settings 对象', code: 'VALIDATION_ERROR' });
    }

    const allowedKeys = ['storeStatus', 'businessHours', 'announcement', 'socialMedia', 'storeDescription'];
    const results = {};

    for (const [k, v] of Object.entries(settings)) {
      if (!allowedKeys.includes(k)) continue;
      const dbKey = 'website_' + k;
      const doc = await SystemSetting.findOneAndUpdate(
        { key: dbKey },
        { key: dbKey, value: v, updatedBy: req.user.userId, updatedAt: new Date() },
        { upsert: true, new: true }
      );
      results[k] = doc.value;
    }

    logAdminAction({
      action: AUDIT_ACTIONS.WEBSITE_UPDATE,
      operator: req.user.userId,
      targetType: 'website',
      targetId: 'website_settings',
      details: { updatedKeys: Object.keys(results) },
      ip: req.ip || req.connection?.remoteAddress,
    });

    res.json(results);
  } catch (err) {
    res.status(500).json({ error: '服务器错误' });
  }
});

module.exports = router;
