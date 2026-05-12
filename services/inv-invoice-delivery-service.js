/**
 * inv-invoice-delivery-service.js — Invoice Delivery Service
 *
 * Handles invoice PDF generation, email sending with PDF attachment,
 * and invoice data retrieval.
 * All deliveries are audit-logged.
 *
 * Uses Invoice snapshot data only — NO recalculation from Transaction.
 */

const { encryptData, createTransporter } = require('../utils/inv-crypto');
const mongoose = require('mongoose');
const Invoice = require('../models/inv/Invoice');
const AuditLog = require('../models/inv/AuditLog');
const pdfGenerator = require('./inv-invoice-pdf');

function escapeHtml(str) {
  return String(str || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}
const shareService = require('./inv-share-service');

// ─── Helpers ─────────────────────────────────────────────────────────────

// ─── Service Functions ───────────────────────────────────────────────────

/**
 * Send an invoice via email with PDF attachment.
 *
 * @param {string} invoiceId - Invoice ObjectId
 * @param {string} recipientEmail - Recipient email address
 * @param {string} operatorId - User ObjectId of the operator
 * @returns {Promise<{success: boolean, messageId?: string, error?: string}>}
 */
async function emailInvoice(invoiceId, recipientEmail, operatorId) {
  if (!mongoose.Types.ObjectId.isValid(invoiceId)) {
    throw Object.assign(new Error('Invalid invoice ID'), { code: 'VALIDATION_ERROR' });
  }
  if (!recipientEmail || typeof recipientEmail !== 'string' || !recipientEmail.includes('@')) {
    throw Object.assign(new Error('Valid recipient email is required'), { code: 'VALIDATION_ERROR' });
  }

  const invoice = await Invoice.findById(invoiceId);
  if (!invoice) {
    throw Object.assign(new Error('Invoice not found'), { code: 'NOT_FOUND' });
  }

  // Generate PDF
  const pdfBuffer = await pdfGenerator.generate(invoice);

  // ─── Build professional email ─────────────────────────────────────
  const customerName = invoice.customerName || 'Valued Customer';
  const company = invoice.companyInfo || {};
  const storeName = company.businessName || 'TechCross Repair Centre';
  const storeAddress = company.address || 'Navan, Co. Meath, Ireland';
  const storePhone = company.phone || '046 905 9854';

  const totalFormatted = '€' + (invoice.grossTotal || 0).toFixed(2);

  const esc = {
    customerName: escapeHtml(customerName),
    storeName: escapeHtml(storeName),
    storeAddress: escapeHtml(storeAddress),
    storePhone: escapeHtml(storePhone),
    vatNumber: escapeHtml(company.vatNumber || ''),
  };

  const htmlBody = '<!DOCTYPE html>'
    + '<html><head><meta charset="UTF-8"><style>'
    + 'body{font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif;background:#f4f4f7;margin:0;padding:0}'
    + '.container{max-width:560px;margin:0 auto;padding:32px 20px}'
    + '.card{background:#ffffff;border-radius:16px;padding:32px 28px;box-shadow:0 1px 3px rgba(0,0,0,0.08)}'
    + '.logo{font-size:22px;font-weight:700;color:#1E7F5C;margin-bottom:4px}'
    + '.tagline{font-size:13px;color:#8e8e93;margin-bottom:24px}'
    + 'h1{font-size:20px;color:#1c1c1e;margin:0 0 8px 0}'
    + 'p{font-size:15px;color:#3a3a3c;line-height:1.6;margin:0 0 16px 0}'
    + '.invoice-box{background:#f8f8fa;border-radius:10px;padding:16px;margin:20px 0}'
    + '.invoice-row{display:flex;justify-content:space-between;padding:6px 0;font-size:14px}'
    + '.invoice-label{color:#6e6e73}'
    + '.invoice-value{font-weight:600;color:#1c1c1e}'
    + '.total-row{display:flex;justify-content:space-between;padding:10px 0 0 0;margin-top:8px;border-top:2px solid #e5e5ea;font-size:16px;font-weight:700;color:#1c1c1e}'
    + '.footer{text-align:center;padding:24px 0 0 0;font-size:13px;color:#8e8e93;line-height:1.6}'
    + '.footer strong{color:#1E7F5C}'
    + '</style></head><body>'
    + '<div class="container">'
    + '<div class="card">'
    + '<div class="logo">' + esc.storeName + '</div>'
    + '<div class="tagline">' + esc.storeAddress + (esc.storePhone ? ' &middot; ' + esc.storePhone : '') + '</div>'
    + '<h1>Thank you for your purchase!</h1>'
    + '<p>Dear ' + esc.customerName + ',</p>'
    + '<p>Please find attached your VAT Invoice <strong>' + invoice.invoiceNumber + '</strong> for your recent purchase at ' + esc.storeName + '.</p>'
    + '<div class="invoice-box">'
    + '<div class="invoice-row"><span class="invoice-label">Invoice Number</span><span class="invoice-value">' + invoice.invoiceNumber + '</span></div>'
    + '<div class="invoice-row"><span class="invoice-label">Total Paid</span><span class="invoice-value">' + totalFormatted + '</span></div>'
    + '</div>'
    + '<p>Your invoice PDF is attached to this email. You may also access it anytime through your shared link.</p>'
    + '<p>We look forward to welcoming you again. If you have any questions, please don\'t hesitate to contact us.</p>'
    + '<p style="margin-bottom:0">Best regards,<br><strong>' + esc.storeName + ' Team</strong></p>'
    + '</div>'
    + '<div class="footer">'
    + '<strong>' + esc.storeName + '</strong><br>'
    + esc.storeAddress + '<br>'
    + (esc.storePhone ? 'Phone: ' + esc.storePhone + '<br>' : '')
    + (esc.vatNumber ? 'VAT: ' + esc.vatNumber : '')
    + '</div>'
    + '</div></body></html>';

  const textBody = 'Dear ' + customerName + ',\n\n'
    + 'Thank you for your purchase at ' + storeName + '.\n\n'
    + 'Please find attached your VAT Invoice ' + invoice.invoiceNumber + '.\n'
    + 'Total Paid: ' + totalFormatted + '\n\n'
    + 'If you have any questions, please feel free to contact us:\n'
    + storeAddress + '\n'
    + (storePhone ? 'Phone: ' + storePhone + '\n' : '')
    + (company.vatNumber ? 'VAT: ' + company.vatNumber + '\n' : '')
    + '\nWe look forward to seeing you again!\n\n'
    + 'Best regards,\n'
    + storeName + ' Team';

  const transporter = createTransporter();
  const info = await transporter.sendMail({
    from: process.env.SMTP_FROM || process.env.SMTP_USER,
    to: recipientEmail,
    subject: 'Your VAT Invoice ' + invoice.invoiceNumber + ' — ' + storeName,
    text: textBody,
    html: htmlBody,
    attachments: [{
      filename: invoice.invoiceNumber + '.pdf',
      content: pdfBuffer,
      contentType: 'application/pdf',
    }],
  });

  // Update invoice status
  invoice.emailStatus = 'sent';
  invoice.emailSentAt = new Date();
  invoice.customerContact = recipientEmail;
  await invoice.save();

  // Audit log
  try {
    await AuditLog.create({
      action: 'INVOICE_EMAILED',
      operator: operatorId,
      targetType: 'Invoice',
      targetId: invoice._id.toString(),
      encryptedData: encryptData({
        invoiceNumber: invoice.invoiceNumber,
        receiptNumber: invoice.receiptNumber,
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
 * Generate PDF buffer for an invoice.
 *
 * @param {string} invoiceId - Invoice ObjectId
 * @returns {Promise<Buffer>} PDF buffer
 */
async function getInvoicePdf(invoiceId) {
  if (!mongoose.Types.ObjectId.isValid(invoiceId)) {
    throw Object.assign(new Error('Invalid invoice ID'), { code: 'VALIDATION_ERROR' });
  }

  const invoice = await Invoice.findById(invoiceId);
  if (!invoice) {
    throw Object.assign(new Error('Invoice not found'), { code: 'NOT_FOUND' });
  }

  return pdfGenerator.generate(invoice);
}

/**
 * Get invoice data for frontend display.
 *
 * @param {string} invoiceId - Invoice ObjectId
 * @returns {Promise<Object>} Invoice document
 */
async function getInvoiceData(invoiceId) {
  if (!mongoose.Types.ObjectId.isValid(invoiceId)) {
    throw Object.assign(new Error('Invalid invoice ID'), { code: 'VALIDATION_ERROR' });
  }

  const invoice = await Invoice.findById(invoiceId)
    .populate('operator', 'displayName username');

  if (!invoice) {
    throw Object.assign(new Error('Invoice not found'), { code: 'NOT_FOUND' });
  }

  return invoice;
}

/**
 * Generate a WhatsApp deep link for invoice sharing.
 * Uses secure share token (14-day expiry). Message format per spec.
 *
 * @param {string} invoiceId - Invoice ObjectId
 * @param {string} phoneNumber - Customer phone number
 * @param {string} operatorId - User ObjectId of the operator
 * @returns {Promise<{link: string, text: string, shareUrl: string, pdfUrl: string, expiresAt: Date}>}
 */
async function getInvoiceWhatsAppLink(invoiceId, phoneNumber, operatorId) {
  if (!mongoose.Types.ObjectId.isValid(invoiceId)) {
    throw Object.assign(new Error('Invalid invoice ID'), { code: 'VALIDATION_ERROR' });
  }

  const invoice = await Invoice.findById(invoiceId).select('invoiceNumber receiptNumber');
  if (!invoice) {
    throw Object.assign(new Error('Invoice not found'), { code: 'NOT_FOUND' });
  }

  // Create secure share token
  const { shareUrl, pdfUrl, expiresAt } = await shareService.createInvoiceToken(invoiceId, operatorId);

  // Normalize phone number
  let cleanPhone = String(phoneNumber || '').replace(/\D/g, '');
  if (!cleanPhone.startsWith('353') && cleanPhone.startsWith('08')) {
    cleanPhone = '353' + cleanPhone.slice(1);
  } else if (!cleanPhone.startsWith('353') && cleanPhone.startsWith('8')) {
    cleanPhone = '353' + cleanPhone;
  } else if (!cleanPhone.startsWith('353')) {
    cleanPhone = '353' + cleanPhone;
  }

  const text = 'Hi,\n\n'
    + 'Your TechCross invoice is ready.\n\n'
    + 'View / Download:\n'
    + shareUrl + '\n\n'
    + 'This secure link expires in 14 days.';

  const link = 'https://wa.me/' + cleanPhone + '?text=' + encodeURIComponent(text);

  return { link, text, shareUrl, pdfUrl, expiresAt };
}

module.exports = {
  emailInvoice,
  getInvoicePdf,
  getInvoiceData,
  getInvoiceWhatsAppLink,
};
