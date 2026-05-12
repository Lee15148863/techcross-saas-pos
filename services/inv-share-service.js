/**
 * inv-share-service.js — Secure Temporary Sharing Service
 *
 * Creates and manages temporary tokens for sharing receipts/invoices.
 * Tokens are 64-char crypto random — no raw DB IDs exposed in URLs.
 * Expire after 14 days. Access count tracked for audit.
 */

const crypto = require('crypto');
const { encryptData } = require('../utils/inv-crypto');
const mongoose = require('mongoose');
const ShareToken = require('../models/inv/ShareToken');
const Transaction = require('../models/inv/Transaction');
const Invoice = require('../models/inv/Invoice');
const AuditLog = require('../models/inv/AuditLog');

const TOKEN_BYTES = 32;      // 64 hex chars
const TOKEN_DAYS = 14;       // 14-day expiry
const BASE_URL = process.env.BASE_URL || 'https://techcross.ie';

// ─── Helpers ─────────────────────────────────────────────────────────────

/**
 * Generate a cryptographically random token string.
 * Uses crypto.randomBytes for true randomness (not Math.random).
 */
function generateToken() {
  return crypto.randomBytes(TOKEN_BYTES).toString('hex');
}

/**
 * Calculate expiry date (14 days from now).
 */
function expiryDate() {
  const d = new Date();
  d.setDate(d.getDate() + TOKEN_DAYS);
  return d;
}

// ─── Service Functions ───────────────────────────────────────────────────

/**
 * Create a share token for a receipt (Transaction).
 *
 * @param {string} transactionId - Transaction ObjectId
 * @param {string} createdBy - InvUser ObjectId
 * @returns {Promise<{token: string, shareUrl: string, expiresAt: Date}>}
 */
async function createReceiptToken(transactionId, createdBy) {
  if (!mongoose.Types.ObjectId.isValid(transactionId)) {
    throw Object.assign(new Error('Invalid transaction ID'), { code: 'VALIDATION_ERROR' });
  }

  const transaction = await Transaction.findById(transactionId).select('receiptNumber');
  if (!transaction) {
    throw Object.assign(new Error('Transaction not found'), { code: 'NOT_FOUND' });
  }

  const token = generateToken();
  const expiresAt = expiryDate();

  await ShareToken.create({
    token,
    type: 'receipt',
    transactionId: transaction._id,
    expiresAt,
    createdBy,
  });

  const shareUrl = BASE_URL + '/share/receipt/' + token;

  // Audit log
  try {
    await AuditLog.create({
      action: 'SHARE_TOKEN_CREATED',
      operator: createdBy,
      targetType: 'Transaction',
      targetId: transaction._id.toString(),
      encryptedData: encryptData({
        type: 'receipt',
        receiptNumber: transaction.receiptNumber,
        expiresAt: expiresAt.toISOString(),
      }),
      module: 'checkout',
      createdAt: new Date(),
    });
  } catch (_) { /* non-blocking */ }

  return { token, shareUrl, expiresAt };
}

/**
 * Create a share token for an invoice.
 *
 * @param {string} invoiceId - Invoice ObjectId
 * @param {string} createdBy - InvUser ObjectId
 * @returns {Promise<{token: string, shareUrl: string, pdfUrl: string, expiresAt: Date}>}
 */
async function createInvoiceToken(invoiceId, createdBy) {
  if (!mongoose.Types.ObjectId.isValid(invoiceId)) {
    throw Object.assign(new Error('Invalid invoice ID'), { code: 'VALIDATION_ERROR' });
  }

  const invoice = await Invoice.findById(invoiceId).select('invoiceNumber receiptNumber');
  if (!invoice) {
    throw Object.assign(new Error('Invoice not found'), { code: 'NOT_FOUND' });
  }

  const token = generateToken();
  const expiresAt = expiryDate();

  await ShareToken.create({
    token,
    type: 'invoice',
    invoiceId: invoice._id,
    expiresAt,
    createdBy,
  });

  const shareUrl = BASE_URL + '/share/invoice/' + token;
  const pdfUrl = BASE_URL + '/share/invoice/' + token + '/pdf';

  // Audit log
  try {
    await AuditLog.create({
      action: 'SHARE_TOKEN_CREATED',
      operator: createdBy,
      targetType: 'Invoice',
      targetId: invoice._id.toString(),
      encryptedData: encryptData({
        type: 'invoice',
        invoiceNumber: invoice.invoiceNumber,
        receiptNumber: invoice.receiptNumber,
        expiresAt: expiresAt.toISOString(),
      }),
      module: 'checkout',
      createdAt: new Date(),
    });
  } catch (_) { /* non-blocking */ }

  return { token, shareUrl, pdfUrl, expiresAt };
}

/**
 * Validate a token and return associated data.
 * Increments accessCount on successful access.
 * Throws with code 'EXPIRED' if token is not found or past expiry.
 *
 * @param {string} token - The 64-char token
 * @returns {Promise<{type: string, transaction?: Object, invoice?: Object}>}
 */
async function getShareData(token) {
  if (!token || typeof token !== 'string' || token.length < 10) {
    throw Object.assign(new Error('Invalid token'), { code: 'EXPIRED' });
  }

  const doc = await ShareToken.findOne({ token });
  if (!doc) {
    throw Object.assign(new Error('This link has expired. Please contact TechCross.'), { code: 'EXPIRED' });
  }

  // Check expiry
  if (new Date() > doc.expiresAt) {
    throw Object.assign(new Error('This link has expired. Please contact TechCross.'), { code: 'EXPIRED' });
  }

  // Increment access count
  doc.accessCount = (doc.accessCount || 0) + 1;
  await doc.save();

  // Load associated data
  if (doc.type === 'receipt' && doc.transactionId) {
    const transaction = await Transaction.findById(doc.transactionId)
      .populate('operator', 'displayName username');
    if (!transaction) {
      throw Object.assign(new Error('Receipt not found'), { code: 'NOT_FOUND' });
    }
    return { type: 'receipt', transaction: transaction.toObject() };
  }

  if (doc.type === 'invoice' && doc.invoiceId) {
    const invoice = await Invoice.findById(doc.invoiceId)
      .populate('operator', 'displayName username');
    if (!invoice) {
      throw Object.assign(new Error('Invoice not found'), { code: 'NOT_FOUND' });
    }
    return { type: 'invoice', invoice: invoice.toObject() };
  }

  throw Object.assign(new Error('Invalid share link'), { code: 'EXPIRED' });
}

/**
 * Get token metadata without incrementing access count.
 * Used for preview/validation purposes.
 */
async function peekToken(token) {
  if (!token || typeof token !== 'string') return null;
  const doc = await ShareToken.findOne({ token }).select('type expiresAt accessCount createdAt').lean();
  if (!doc) return null;
  if (new Date() > doc.expiresAt) return null;
  return doc;
}

/**
 * Revoke a share token by deleting it.
 */
async function revokeToken(token) {
  if (!token || typeof token !== 'string') return;
  await ShareToken.deleteOne({ token });
}

module.exports = {
  createReceiptToken,
  createInvoiceToken,
  getShareData,
  peekToken,
  revokeToken,
  generateToken,
};
