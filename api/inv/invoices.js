const express = require('express');
const router = express.Router();
const crypto = require('crypto');
const { createTransporter } = require('../../utils/inv-crypto');
const mongoose = require('mongoose');
const Invoice = require('../../models/inv/Invoice');
const Transaction = require('../../models/inv/Transaction');
const SystemSetting = require('../../models/inv/SystemSetting');
const AuditLog = require('../../models/inv/AuditLog');
const { jwtAuth, requireRole } = require('../../middleware/inv-auth');
const pdfGenerator = require('../../services/inv-invoice-pdf');

// ─── Helper: Generate share token ───────────────────────────────────────
function generateShareToken() {
  return crypto.randomBytes(24).toString('hex');
}

// ─── PUBLIC: Shared invoice routes (no auth required) ─────────────────────
// These MUST be registered before the auth middleware.

router.get('/shared/:token/pdf', async (req, res) => {
  try {
    const invoice = await Invoice.findOne({ shareToken: req.params.token });
    if (!invoice) {
      return res.status(404).json({ error: 'Invoice not found or link is invalid' });
    }
    if (invoice.shareTokenExpiresAt && new Date() > invoice.shareTokenExpiresAt) {
      return res.status(410).json({ error: 'Sharing link has expired' });
    }
    const pdfBuffer = await pdfGenerator.generate(invoice);
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', 'inline; filename="' + invoice.invoiceNumber + '.pdf"');
    res.send(pdfBuffer);
  } catch (err) {
    res.status(500).json({ error: 'Failed to generate PDF' });
  }
});

router.get('/shared/:token/meta', async (req, res) => {
  try {
    const invoice = await Invoice.findOne({ shareToken: req.params.token })
      .select('invoiceNumber receiptNumber grossTotal createdAt hasMarginItems companyInfo');
    if (!invoice) {
      return res.status(404).json({ error: 'Invoice not found' });
    }
    if (invoice.shareTokenExpiresAt && new Date() > invoice.shareTokenExpiresAt) {
      return res.status(410).json({ error: 'Sharing link has expired' });
    }
    res.json(invoice);
  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
});

// ─── All remaining routes require Staff+ access ─────────────────────────
router.use(jwtAuth, requireRole('root', 'manager', 'staff'));

// ─── Helper: Get company info snapshot ──────────────────────────────────
async function getCompanySnapshot() {
  const defaults = {
    businessName: 'TechCross Repair Centre',
    vatNumber: 'IE3330982OH',
    address: 'UNIT M.4, Navan Town Centre, Kennedy Road, Navan, Co. Meath, C15 F658',
    phone: '046 905 9854',
    email: ''
  };
  try {
    const setting = await SystemSetting.findOne({ key: 'companyInfo' });
    if (setting && setting.value) {
      return {
        businessName: setting.value.name || defaults.businessName,
        vatNumber: setting.value.vatNumber || defaults.vatNumber,
        address: setting.value.address || defaults.address,
        phone: setting.value.phone || defaults.phone,
        email: setting.value.email || defaults.email
      };
    }
  } catch (_) { /* fallback */ }
  return defaults;
}

// ─── Helper: Generate invoice number ────────────────────────────────────
function makeInvoiceNumber(receiptNumber) {
  return 'INV-' + (receiptNumber || '');
}

// ─── Helper: Create SMTP transporter ────────────────────────────────────
// ─── Helper: Build professional invoice email ──────────────────────────
function buildInvoiceEmail(invoice, pdfBuffer, recipientEmail) {
  const customerName = invoice.customerName || 'Valued Customer';
  const company = invoice.companyInfo || {};
  const storeName = company.businessName || 'TechCross Repair Centre';
  const storeAddress = company.address || 'Navan, Co. Meath, Ireland';
  const storePhone = company.phone || '';
  const totalFormatted = '€' + (invoice.grossTotal || 0).toFixed(2);

  const html = '<!DOCTYPE html>'
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
    + '<div class="container"><div class="card">'
    + '<div class="logo">' + storeName + '</div>'
    + '<div class="tagline">' + storeAddress + (storePhone ? ' &middot; ' + storePhone : '') + '</div>'
    + '<h1>Thank you for your purchase!</h1>'
    + '<p>Dear ' + customerName + ',</p>'
    + '<p>Please find attached your VAT Invoice <strong>' + invoice.invoiceNumber + '</strong> for your recent purchase at ' + storeName + '.</p>'
    + '<div class="invoice-box">'
    + '<div class="invoice-row"><span class="invoice-label">Invoice Number</span><span class="invoice-value">' + invoice.invoiceNumber + '</span></div>'
    + '<div class="invoice-row"><span class="invoice-label">Total Paid</span><span class="invoice-value">' + totalFormatted + '</span></div>'
    + '</div>'
    + '<p>Your invoice PDF is attached to this email. You may also access it anytime through your shared link.</p>'
    + '<p>We look forward to welcoming you again. If you have any questions, please don\'t hesitate to contact us.</p>'
    + '<p style="margin-bottom:0">Best regards,<br><strong>' + storeName + ' Team</strong></p>'
    + '</div><div class="footer">'
    + '<strong>' + storeName + '</strong><br>' + storeAddress
    + (storePhone ? '<br>Phone: ' + storePhone : '')
    + (company.vatNumber ? '<br>VAT: ' + company.vatNumber : '')
    + '</div></div></body></html>';

  const text = 'Dear ' + customerName + ',\n\n'
    + 'Thank you for your purchase at ' + storeName + '.\n\n'
    + 'Please find attached your VAT Invoice ' + invoice.invoiceNumber + '.\n'
    + 'Total Paid: ' + totalFormatted + '\n\n'
    + (storePhone ? 'Phone: ' + storePhone + '\n' : '')
    + (company.vatNumber ? 'VAT: ' + company.vatNumber + '\n' : '')
    + '\nWe look forward to seeing you again!\n\n'
    + 'Best regards,\n' + storeName + ' Team';

  return {
    from: process.env.SMTP_FROM || process.env.SMTP_USER,
    to: recipientEmail,
    subject: 'Your VAT Invoice ' + invoice.invoiceNumber + ' — ' + storeName,
    text: text,
    html: html,
    attachments: [{
      filename: invoice.invoiceNumber + '.pdf',
      content: pdfBuffer,
      contentType: 'application/pdf'
    }]
  };
}

// ─── GET /api/inv/invoices ──────────────────────────────────────────────
// Invoice list with filters
router.get('/', async (req, res) => {
  try {
    const filter = {};
    const { invoiceNumber, customer, startDate, endDate } = req.query;

    if (invoiceNumber) {
      filter.invoiceNumber = { $regex: invoiceNumber.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), $options: 'i' };
    }
    if (customer) {
      filter.customerName = { $regex: customer.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), $options: 'i' };
    }
    if (startDate || endDate) {
      filter.createdAt = {};
      if (startDate) filter.createdAt.$gte = new Date(startDate);
      if (endDate) {
        const end = new Date(endDate);
        end.setHours(23, 59, 59, 999);
        filter.createdAt.$lte = end;
      }
    }

    const invoices = await Invoice.find(filter)
      .populate('transaction', 'receiptNumber totalAmount paymentMethod createdAt')
      .sort({ createdAt: -1 });

    res.json({ data: invoices });
  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
});

// ─── GET /api/inv/invoices/check-transaction/:receiptNumber ─────────────
// Check if an invoice exists for a given receipt number.
// Used by POS frontend to show/hide the "Generate Invoice" button.
router.get('/check-transaction/:receiptNumber', async (req, res) => {
  try {
    const existing = await Invoice.findOne({ receiptNumber: req.params.receiptNumber })
      .select('invoiceNumber createdAt grossTotal');
    res.json({ exists: !!existing, invoice: existing || null });
  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
});

// ─── POST /api/inv/invoices/:transactionId/generate ─────────────────────
// Generate production VAT Invoice from a Transaction.
// CRITICAL: All financial values are COPIED, never recalculated.
router.post('/:transactionId/generate', async (req, res) => {
  try {
    const { transactionId } = req.params;
    const { customerName, customerContact } = req.body;

    // Validate transaction ID format
    if (!mongoose.Types.ObjectId.isValid(transactionId)) {
      return res.status(400).json({ error: 'Invalid transaction ID format' });
    }

    // Find transaction with operator populated
    const transaction = await Transaction.findById(transactionId)
      .populate('operator', 'displayName username');
    if (!transaction) {
      return res.status(404).json({ error: 'Transaction not found' });
    }

    // Check if invoice already exists
    if (transaction.invoiceGenerated) {
      const existing = await Invoice.findOne({ transaction: transactionId });
      if (existing) {
        return res.status(409).json({
          error: 'Invoice already exists for this transaction',
          code: 'INVOICE_EXISTS',
          invoice: existing
        });
      }
    }

    // ─── Snapshot company info ──────────────────────────────────
    const companyInfo = await getCompanySnapshot();

    // ─── Build invoice items from Transaction items ─────────────
    // NO VAT recalculation — use stored vatAmount and marginVat.
    let standardVatSum = 0;   // 23% items
    let reducedVatSum = 0;    // 13.5% items
    let marginVatSum = transaction.marginVatTotal || 0;

    const invoiceItems = transaction.items.map(function (item) {
      const price = item.discountedPrice != null ? item.discountedPrice : item.unitPrice;
      const isMargin = item.isSecondHand || item.marginScheme;

      // Group already-computed VAT by rate (no recalculation)
      if (isMargin) {
        // marginVat already counted in marginVatSum above
      } else if (item.vatRate === 0.135) {
        reducedVatSum += item.vatAmount || 0;
      } else {
        standardVatSum += item.vatAmount || 0;
      }

      return {
        name: item.name,
        quantity: item.quantity,
        unitPrice: price,
        vatType: isMargin ? 'margin' : (item.vatRate === 0.135 ? 'reduced' : 'standard'),
        vatRate: isMargin ? 0 : (item.vatRate || 0.23),
        vatAmount: isMargin ? 0 : (item.vatAmount || 0),
        lineTotal: item.subtotal
      };
    });

    // ─── Order discount line item ────────────────────────────────
    // When an order-level discount exists, add a negative line so that
    // sum(invoice.items.lineTotal) === invoice.grossTotal (transaction.totalAmount).
    // The discount line has vatRate=0 / vatAmount=0 — VAT was already
    // computed on the discounted amounts stored in the transaction.
    const hasOrderDiscount = transaction.orderDiscount
      && transaction.orderDiscount.type
      && transaction.orderDiscount.value > 0;
    if (hasOrderDiscount && transaction.subtotalBeforeOrderDiscount != null) {
      const discountAmount = Math.round(
        (transaction.subtotalBeforeOrderDiscount - transaction.totalAmount) * 100
      ) / 100;
      if (discountAmount > 0) {
        invoiceItems.push({
          name: 'Order Discount',
          quantity: 1,
          unitPrice: -discountAmount,
          vatType: 'standard',
          vatRate: 0,
          vatAmount: 0,
          lineTotal: -discountAmount,
        });
      }
    }

    // Round to avoid floating-point display issues
    standardVatSum = Math.round(standardVatSum * 100) / 100;
    reducedVatSum = Math.round(reducedVatSum * 100) / 100;
    marginVatSum = Math.round(marginVatSum * 100) / 100;

    // subtotalExVat = grossTotal - totalVAT
    const totalVat = standardVatSum + reducedVatSum + marginVatSum;
    const subtotalExVat = Math.round((transaction.totalAmount - totalVat) * 100) / 100;

    const hasMarginItems = transaction.items.some(function (i) {
      return i.isSecondHand || i.marginScheme;
    });

    // ─── Invoice number ─────────────────────────────────────────
    const invoiceNumber = makeInvoiceNumber(transaction.receiptNumber);

    // ─── Determine operator display name ────────────────────────
    const operatorName = (transaction.operator && (transaction.operator.displayName || transaction.operator.username)) || '';

    // ─── Create Invoice record ──────────────────────────────────
    const invoice = await Invoice.create({
      invoiceNumber: invoiceNumber,
      transaction: transaction._id,
      receiptNumber: transaction.receiptNumber,
      transactionDate: transaction.createdAt || new Date(),
      companyInfo: companyInfo,
      customerName: (customerName || '').trim(),
      customerContact: (customerContact || '').trim(),
      items: invoiceItems,
      subtotalExVat: subtotalExVat,
      standardVatTotal: standardVatSum,
      reducedVatTotal: reducedVatSum,
      marginVatTotal: marginVatSum,
      grossTotal: transaction.totalAmount,
      hasMarginItems: hasMarginItems,
      paymentMethod: transaction.paymentMethod,
      cashAmount: transaction.cashReceived || null,
      cardAmount: transaction.cardAmount || null,
      changeGiven: transaction.changeGiven || null,
      operator: transaction.operator ? transaction.operator._id : null,
      operatorName: operatorName,
      auditRef: 'TXN-' + transaction._id
    });

    // ─── Mark transaction as invoiced ───────────────────────────
    transaction.invoiceGenerated = true;
    await transaction.save();

    // ─── Audit log ──────────────────────────────────────────────
    try {
      await AuditLog.create({
        action: 'INVOICE_GENERATED',
        targetType: 'Invoice',
        targetId: invoice._id,
        details: {
          invoiceNumber: invoiceNumber,
          receiptNumber: transaction.receiptNumber,
          transactionId: transaction._id,
          grossTotal: transaction.totalAmount
        },
        operator: req.user ? req.user.userId : null,
        createdAt: new Date()
      });
    } catch (_) { /* non-blocking */ }

    // ─── Auto-generate PDF after creation ───────────────────────
    let pdfBuffer = null;
    try {
      pdfBuffer = await pdfGenerator.generate(invoice);
      invoice.pdfPath = 'invoices/' + invoice.invoiceNumber + '.pdf';
      await invoice.save();
    } catch (_) { /* PDF generation failure is non-fatal; retry later */ }

    res.status(201).json({
      invoice: invoice,
      pdfAvailable: !!pdfBuffer
    });
  } catch (err) {
    if (err.code === 11000) {
      return res.status(409).json({
        error: 'Duplicate invoice number. An invoice may already exist for this transaction.',
        code: 'DUPLICATE_INVOICE'
      });
    }
    if (err.name === 'CastError') {
      return res.status(404).json({ error: 'Transaction not found' });
    }
    res.status(500).json({ error: 'Server error' });
  }
});

// ─── POST /api/inv/invoices/:id/regenerate-pdf ─────────────────────────
// Regenerate PDF for an existing invoice (e.g. after layout changes).
router.post('/:id/regenerate-pdf', async (req, res) => {
  try {
    const invoice = await Invoice.findById(req.params.id);
    if (!invoice) {
      return res.status(404).json({ error: 'Invoice not found' });
    }

    const pdfBuffer = await pdfGenerator.generate(invoice);
    invoice.pdfPath = 'invoices/' + invoice.invoiceNumber + '.pdf';
    await invoice.save();

    res.json({ message: 'PDF regenerated', pdfAvailable: true });
  } catch (err) {
    res.status(500).json({ error: 'Failed to regenerate PDF' });
  }
});

// ─── GET /api/inv/invoices/:id/pdf ──────────────────────────────────────
// Download Invoice PDF
router.get('/:id/pdf', async (req, res) => {
  try {
    const invoice = await Invoice.findById(req.params.id);
    if (!invoice) {
      return res.status(404).json({ error: 'Invoice not found' });
    }

    const pdfBuffer = await pdfGenerator.generate(invoice);

    // Store reference
    invoice.pdfPath = 'invoices/' + invoice.invoiceNumber + '.pdf';
    await invoice.save();

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', 'attachment; filename="' + invoice.invoiceNumber + '.pdf"');
    res.send(pdfBuffer);
  } catch (err) {
    if (err.name === 'CastError') {
      return res.status(404).json({ error: 'Invoice not found' });
    }
    res.status(500).json({ error: 'Failed to generate PDF' });
  }
});

// ─── GET /api/inv/invoices/:id/preview ──────────────────────────────────
// Preview Invoice PDF in browser (inline, not download)
router.get('/:id/preview', async (req, res) => {
  try {
    const invoice = await Invoice.findById(req.params.id);
    if (!invoice) {
      return res.status(404).json({ error: 'Invoice not found' });
    }

    const pdfBuffer = await pdfGenerator.generate(invoice);

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', 'inline; filename="' + invoice.invoiceNumber + '.pdf"');
    res.send(pdfBuffer);
  } catch (err) {
    if (err.name === 'CastError') {
      return res.status(404).json({ error: 'Invoice not found' });
    }
    res.status(500).json({ error: 'Failed to generate PDF' });
  }
});

// ─── POST /api/inv/invoices/:id/share ──────────────────────────────────
// Generate a secure sharing link for the invoice
router.post('/:id/share', async (req, res) => {
  try {
    const invoice = await Invoice.findById(req.params.id);
    if (!invoice) {
      return res.status(404).json({ error: 'Invoice not found' });
    }

    // Generate or reuse existing token
    if (!invoice.shareToken) {
      invoice.shareToken = generateShareToken();
    }

    // Set expiry if provided (default: no expiry)
    const { expiresInDays } = req.body;
    if (expiresInDays && Number.isInteger(expiresInDays) && expiresInDays > 0) {
      invoice.shareTokenExpiresAt = new Date(Date.now() + expiresInDays * 86400000);
    } else {
      invoice.shareTokenExpiresAt = null; // never expires
    }

    await invoice.save();

    const shareUrl = '/api/inv/invoices/shared/' + invoice.shareToken + '/pdf';

    res.json({
      shareToken: invoice.shareToken,
      shareUrl: shareUrl,
      expiresAt: invoice.shareTokenExpiresAt
    });
  } catch (err) {
    res.status(500).json({ error: 'Failed to generate sharing link' });
  }
});

// ─── DELETE /api/inv/invoices/:id/share ────────────────────────────────
// Revoke sharing link
router.delete('/:id/share', async (req, res) => {
  try {
    const invoice = await Invoice.findById(req.params.id);
    if (!invoice) {
      return res.status(404).json({ error: 'Invoice not found' });
    }

    invoice.shareToken = undefined;
    invoice.shareTokenExpiresAt = undefined;
    await invoice.save();

    res.json({ message: 'Sharing link revoked' });
  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
});

// ─── POST /api/inv/invoices/batch-send ──────────────────────────────────
// Batch send invoices via email
router.post('/batch-send', async (req, res) => {
  try {
    const { invoiceIds } = req.body;

    if (!invoiceIds || !Array.isArray(invoiceIds) || invoiceIds.length === 0) {
      return res.status(400).json({ error: 'Missing invoice IDs' });
    }

    const invoices = await Invoice.find({ _id: { $in: invoiceIds } });
    if (invoices.length === 0) {
      return res.status(404).json({ error: 'No invoices found' });
    }

    const transporter = createTransporter();
    const results = [];

    for (const invoice of invoices) {
      if (!invoice.customerContact || !invoice.customerContact.includes('@')) {
        results.push({ invoiceId: invoice._id, status: 'failed', error: 'Missing or invalid customer email' });
        continue;
      }

      try {
        const pdfBuffer = await pdfGenerator.generate(invoice);

        await transporter.sendMail(buildInvoiceEmail(invoice, pdfBuffer, invoice.customerContact));

        invoice.emailStatus = 'sent';
        invoice.emailSentAt = new Date();
        await invoice.save();
        results.push({ invoiceId: invoice._id, status: 'sent' });
      } catch (emailErr) {
        invoice.emailStatus = 'failed';
        await invoice.save();
        results.push({ invoiceId: invoice._id, status: 'failed', error: emailErr.message });
      }
    }

    res.json({ results: results });
  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
});

// ─── POST /api/inv/invoices/:id/send ────────────────────────────────────
// Send single Invoice PDF via email
router.post('/:id/send', async (req, res) => {
  try {
    const { email } = req.body;

    if (!email) {
      return res.status(400).json({ error: 'Missing recipient email' });
    }

    const invoice = await Invoice.findById(req.params.id);
    if (!invoice) {
      return res.status(404).json({ error: 'Invoice not found' });
    }

    const pdfBuffer = await pdfGenerator.generate(invoice);
    const transporter = createTransporter();

    try {
      await transporter.sendMail(buildInvoiceEmail(invoice, pdfBuffer, email));

      invoice.emailStatus = 'sent';
      invoice.emailSentAt = new Date();
      invoice.customerContact = email;
      await invoice.save();

      res.json({ message: 'Invoice sent', emailStatus: 'sent' });
    } catch (emailErr) {
      invoice.emailStatus = 'failed';
      await invoice.save();
      res.status(500).json({ error: 'Email send failed', emailStatus: 'failed' });
    }
  } catch (err) {
    if (err.name === 'CastError') {
      return res.status(404).json({ error: 'Invoice not found' });
    }
    res.status(500).json({ error: 'Server error' });
  }
});

module.exports = router;
