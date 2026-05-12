/**
 * inv-receipt-delivery-service.js — Receipt Delivery Service
 *
 * Handles receipt delivery via email, WhatsApp, and thermal printing.
 * Uses Transaction data only — NO recalculation.
 * WhatsApp links now use secure temporary share tokens (14-day expiry).
 * All deliveries are audit-logged.
 */

const { encryptData, createTransporter } = require('../utils/inv-crypto');
const mongoose = require('mongoose');
const Transaction = require('../models/inv/Transaction');
const AuditLog = require('../models/inv/AuditLog');
const { generateReceipt } = require('../utils/inv-receipt-generator');
const shareService = require('./inv-share-service');

// ─── Configurable company info ──────────────────────────────────────────
const COMPANY_NAME = process.env.COMPANY_NAME || 'TechCross Repair Centre';
const COMPANY_LOCATION = process.env.COMPANY_ADDRESS || 'Navan, Co. Meath';

// ─── Helpers ─────────────────────────────────────────────────────────────

/**
 * Build a lightweight receipt HTML email body.
 */
function buildReceiptEmailHtml(transaction, receiptData) {
  const items = (receiptData.items || []).map(function (item) {
    const total = (item.discountedPrice != null ? item.discountedPrice : item.unitPrice) * (item.quantity || 1);
    return '<tr><td style="padding:4px 8px;border-bottom:1px solid #eee;">'
      + (item.quantity > 1 ? item.quantity + 'x ' : '') + escHtml(item.name)
      + '</td><td style="padding:4px 8px;text-align:right;border-bottom:1px solid #eee;">€' + total.toFixed(2) + '</td></tr>';
  }).join('');

  const pmLabel = transaction.paymentMethod === 'split' ? 'Card + Cash' : transaction.paymentMethod === 'card' ? 'Card' : 'Cash';

  return '<!DOCTYPE html><html><head><meta charset="utf-8"></head><body style="font-family:-apple-system,BlinkMacSystemFont,sans-serif;margin:0;padding:24px;background:#f5f5f7;">'
    + '<div style="max-width:480px;margin:0 auto;background:#fff;border-radius:16px;overflow:hidden;box-shadow:0 2px 12px rgba(0,0,0,.08);">'
    + '<div style="background:#1E7F5C;padding:24px;text-align:center;">'
    + '<h1 style="color:#fff;margin:0;font-size:20px;">' + COMPANY_NAME + '</h1>'
    + '<p style="color:rgba(255,255,255,.8);margin:4px 0 0;font-size:13px;">Receipt #' + escHtml(receiptData.receiptNumber || '') + '</p>'
    + '</div>'
    + '<div style="padding:24px;">'
    + '<p style="font-size:14px;color:#6e6e73;margin:0 0 16px;">Date: ' + escHtml(receiptData.date || '') + '</p>'
    + '<table style="width:100%;border-collapse:collapse;font-size:14px;">'
    + '<thead><tr style="background:#f5f5f7;"><th style="padding:8px;text-align:left;">Item</th><th style="padding:8px;text-align:right;">Total</th></tr></thead>'
    + '<tbody>' + items + '</tbody></table>'
    + '<div style="border-top:2px solid #1E7F5C;margin-top:12px;padding-top:12px;">'
    + '<div style="display:flex;justify-content:space-between;font-size:18px;font-weight:700;"><span>TOTAL</span><span>€' + (transaction.totalAmount || 0).toFixed(2) + '</span></div>'
    + '<div style="display:flex;justify-content:space-between;font-size:13px;color:#6e6e73;margin-top:4px;"><span>Payment</span><span>' + pmLabel + '</span></div>'
    + (transaction.cashReceived != null ? '<div style="display:flex;justify-content:space-between;font-size:13px;color:#6e6e73;"><span>Cash</span><span>€' + Number(transaction.cashReceived).toFixed(2) + '</span></div>' : '')
    + (transaction.changeGiven > 0 ? '<div style="display:flex;justify-content:space-between;font-size:13px;font-weight:600;"><span>Change</span><span>€' + Number(transaction.changeGiven).toFixed(2) + '</span></div>' : '')
    + '</div></div>'
    + '<div style="background:#f5f5f7;padding:16px 24px;text-align:center;font-size:12px;color:#6e6e73;">'
    + '<p style="margin:0;">Thank you for your business!</p>'
    + '<p style="margin:4px 0 0;">' + COMPANY_NAME + ' — ' + COMPANY_LOCATION + '</p>'
    + '</div></div></body></html>';
}

function escHtml(str) {
  if (typeof str !== 'string') return String(str || '');
  return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

// ─── Service Functions ───────────────────────────────────────────────────

/**
 * Send a receipt via email.
 *
 * @param {string} transactionId - Transaction ObjectId
 * @param {string} recipientEmail - Recipient email address
 * @param {string} operatorId - User ObjectId of the operator
 * @returns {Promise<{success: boolean, messageId?: string, error?: string}>}
 */
async function emailReceipt(transactionId, recipientEmail, operatorId) {
  if (!mongoose.Types.ObjectId.isValid(transactionId)) {
    throw Object.assign(new Error('Invalid transaction ID'), { code: 'VALIDATION_ERROR' });
  }
  if (!recipientEmail || typeof recipientEmail !== 'string' || !recipientEmail.includes('@')) {
    throw Object.assign(new Error('Valid recipient email is required'), { code: 'VALIDATION_ERROR' });
  }

  const transaction = await Transaction.findById(transactionId);
  if (!transaction) {
    throw Object.assign(new Error('Transaction not found'), { code: 'NOT_FOUND' });
  }

  const receiptData = generateReceipt(transaction.toObject());
  const htmlBody = buildReceiptEmailHtml(transaction, receiptData);

  const transporter = createTransporter();
  const info = await transporter.sendMail({
    from: process.env.SMTP_FROM || process.env.SMTP_USER,
    to: recipientEmail,
    subject: 'Receipt #' + (transaction.receiptNumber || '') + ' — ' + COMPANY_NAME,
    html: htmlBody,
  });

  // Audit log
  try {
    await AuditLog.create({
      action: 'RECEIPT_EMAILED',
      operator: operatorId,
      targetType: 'Transaction',
      targetId: transaction._id.toString(),
      encryptedData: encryptData({
        receiptNumber: transaction.receiptNumber,
        recipient: recipientEmail,
        messageId: info.messageId,
      }),
      module: 'checkout',
      createdAt: new Date(),
    });
  } catch (_) { /* non-blocking */ }

  return { success: true, messageId: info.messageId };
}

/**
 * Generate a WhatsApp deep link with a secure temporary share URL.
 * Uses share token (no raw DB IDs exposed). Link expires in 14 days.
 * Message format matches spec requirements.
 *
 * @param {string} transactionId - Transaction ObjectId
 * @param {string} phoneNumber - Customer phone number (Irish format)
 * @param {string} operatorId - User ObjectId of the operator
 * @returns {Promise<{link: string, text: string, shareUrl: string, expiresAt: Date}>}
 */
async function getWhatsAppLink(transactionId, phoneNumber, operatorId) {
  if (!mongoose.Types.ObjectId.isValid(transactionId)) {
    throw Object.assign(new Error('Invalid transaction ID'), { code: 'VALIDATION_ERROR' });
  }

  const transaction = await Transaction.findById(transactionId).select('receiptNumber totalAmount');
  if (!transaction) {
    throw Object.assign(new Error('Transaction not found'), { code: 'NOT_FOUND' });
  }

  // Create secure share token
  const { shareUrl, expiresAt } = await shareService.createReceiptToken(transactionId, operatorId);

  // Strip any non-digit characters from phone, ensure it starts with country code
  let cleanPhone = String(phoneNumber || '').replace(/\D/g, '');
  if (!cleanPhone.startsWith('353') && cleanPhone.startsWith('08')) {
    cleanPhone = '353' + cleanPhone.slice(1);
  } else if (!cleanPhone.startsWith('353') && cleanPhone.startsWith('8')) {
    cleanPhone = '353' + cleanPhone;
  } else if (!cleanPhone.startsWith('353')) {
    cleanPhone = '353' + cleanPhone;
  }

  // Message format per spec
  const text = 'Hi,\n\n'
    + 'Your TechCross receipt is ready.\n\n'
    + 'View / Download:\n'
    + shareUrl + '\n\n'
    + 'This secure link expires in 14 days.';

  const link = 'https://wa.me/' + cleanPhone + '?text=' + encodeURIComponent(text);

  return { link, text, shareUrl, expiresAt };
}

/**
 * Get structured receipt print data for a transaction.
 * Uses the existing inv-receipt-generator.
 *
 * @param {string} transactionId - Transaction ObjectId
 * @returns {Promise<Object>} Structured receipt data
 */
async function getPrintData(transactionId) {
  if (!mongoose.Types.ObjectId.isValid(transactionId)) {
    throw Object.assign(new Error('Invalid transaction ID'), { code: 'VALIDATION_ERROR' });
  }

  const transaction = await Transaction.findById(transactionId);
  if (!transaction) {
    throw Object.assign(new Error('Transaction not found'), { code: 'NOT_FOUND' });
  }

  return generateReceipt(transaction.toObject());
}

module.exports = {
  emailReceipt,
  getWhatsAppLink,
  getPrintData,
};
