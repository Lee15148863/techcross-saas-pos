/**
 * System Admin Layer — Audit Logging Service
 *
 * Centralised audit logging for all admin actions.
 * Uses AES-256 encryption for stored details, consistent with
 * the existing pattern in api/inv/settings.js and api/inv/transactions.js.
 */

const { encryptData } = require('../utils/inv-crypto');
const AuditLog = require('../models/inv/AuditLog');

const AUDIT_ACTIONS = Object.freeze({
  USER_CREATE: 'user_create',
  USER_DISABLE: 'user_disable',
  USER_ROLE_CHANGE: 'user_role_change',
  USER_PASSWORD_RESET: 'user_password_reset',
  SETTING_CHANGE: 'setting_change',
  VAT_RATE_CHANGE: 'vat_rate_change',
  WEBSITE_UPDATE: 'website_update',
});

/**
 * Log an admin action to the audit trail.
 *
 * @param {Object} params
 * @param {string} params.action     — AUDIT_ACTIONS key
 * @param {string} params.operator   — User ID
 * @param {string} params.targetType — 'user' | 'setting' | 'website'
 * @param {string} params.targetId   — Identifier for the target
 * @param {Object} params.details    — Free-form details (encrypted before storage)
 * @param {string} [params.ip]       — Request IP address
 */
async function logAdminAction({ action, operator, targetType, targetId, details, ip }) {
  try {
    await AuditLog.create({
      action,
      operator,
      targetType,
      targetId,
      encryptedData: encryptData({
        ...details,
        timestamp: new Date().toISOString(),
      }),
      ip: ip || null,
    });
  } catch (err) {
    // Audit log failure must never break the main operation
    console.error('Admin audit log failed:', err.message);
  }
}

module.exports = { AUDIT_ACTIONS, logAdminAction };
