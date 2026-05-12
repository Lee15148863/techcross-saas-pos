/**
 * delivery.js — Unified Receipt + Invoice Delivery API
 *
 * Endpoints for sending receipts via email/WhatsApp/print,
 * and invoices via email/PDF download.
 *
 * All routes require Staff+ access.
 */

const express = require('express');
const router = express.Router();
const mongoose = require('mongoose');
const { jwtAuth, requireRole } = require('../../middleware/inv-auth');
const receiptService = require('../../services/inv-receipt-delivery-service');
const invoiceService = require('../../services/inv-invoice-delivery-service');
const shareService = require('../../services/inv-share-service');
const Transaction = require('../../models/inv/Transaction');
const Invoice = require('../../models/inv/Invoice');
const AuditLog = require('../../models/inv/AuditLog');

// All routes require Staff+ access
router.use(jwtAuth, requireRole('root', 'manager', 'staff'));

// ─── RECEIPT DELIVERY ───────────────────────────────────────────────────

// ─── POST /delivery/receipt/email ──────────────────────────────────────
// Send receipt via email
router.post('/receipt/email', async (req, res) => {
  try {
    const { transactionId, email } = req.body;

    if (!transactionId || !email) {
      return res.status(400).json({ error: 'transactionId and email are required' });
    }

    const result = await receiptService.emailReceipt(transactionId, email, req.user.userId);

    res.json({ message: 'Receipt sent', ...result });
  } catch (err) {
    if (err.code === 'NOT_FOUND') {
      return res.status(404).json({ error: err.message });
    }
    if (err.code === 'VALIDATION_ERROR') {
      return res.status(400).json({ error: err.message });
    }
    res.status(500).json({ error: 'Failed to send receipt email' });
  }
});

// ─── GET /delivery/receipt/whatsapp/:transactionId ─────────────────────
// Generate WhatsApp deep link for receipt sharing
router.get('/receipt/whatsapp/:transactionId', async (req, res) => {
  try {
    const { transactionId } = req.params;
    const { phone } = req.query;

    if (!phone) {
      return res.status(400).json({ error: 'Phone number is required (query param: phone)' });
    }

    const result = await receiptService.getWhatsAppLink(transactionId, phone, req.user.userId);

    res.json(result);
  } catch (err) {
    if (err.code === 'NOT_FOUND') {
      return res.status(404).json({ error: err.message });
    }
    if (err.code === 'VALIDATION_ERROR') {
      return res.status(400).json({ error: err.message });
    }
    res.status(500).json({ error: 'Failed to generate WhatsApp link' });
  }
});

// ─── GET /delivery/receipt/print/:transactionId ────────────────────────
// Get structured receipt data for printing
router.get('/receipt/print/:transactionId', async (req, res) => {
  try {
    const { transactionId } = req.params;

    const printData = await receiptService.getPrintData(transactionId);

    res.json(printData);
  } catch (err) {
    if (err.code === 'NOT_FOUND') {
      return res.status(404).json({ error: err.message });
    }
    if (err.code === 'VALIDATION_ERROR') {
      return res.status(400).json({ error: err.message });
    }
    res.status(500).json({ error: 'Failed to get print data' });
  }
});

// ─── INVOICE DELIVERY ───────────────────────────────────────────────────

// ─── POST /delivery/invoice/email ──────────────────────────────────────
// Send invoice via email with PDF attachment
router.post('/invoice/email', async (req, res) => {
  try {
    const { invoiceId, email } = req.body;

    if (!invoiceId || !email) {
      return res.status(400).json({ error: 'invoiceId and email are required' });
    }

    const result = await invoiceService.emailInvoice(invoiceId, email, req.user.userId);

    res.json({ message: 'Invoice sent', ...result });
  } catch (err) {
    if (err.code === 'NOT_FOUND') {
      return res.status(404).json({ error: err.message });
    }
    if (err.code === 'VALIDATION_ERROR') {
      return res.status(400).json({ error: err.message });
    }
    res.status(500).json({ error: 'Failed to send invoice email' });
  }
});

// ─── GET /delivery/invoice/pdf/:invoiceId ──────────────────────────────
// Download invoice PDF
router.get('/invoice/pdf/:invoiceId', async (req, res) => {
  try {
    const { invoiceId } = req.params;

    const pdfBuffer = await invoiceService.getInvoicePdf(invoiceId);

    // Fetch invoice for filename
    const invoice = await Invoice.findById(invoiceId).select('invoiceNumber');

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', 'attachment; filename="' + (invoice ? invoice.invoiceNumber : 'invoice') + '.pdf"');
    res.send(pdfBuffer);
  } catch (err) {
    if (err.code === 'NOT_FOUND') {
      return res.status(404).json({ error: err.message });
    }
    if (err.code === 'VALIDATION_ERROR') {
      return res.status(400).json({ error: err.message });
    }
    res.status(500).json({ error: 'Failed to generate PDF' });
  }
});

// ─── GET /delivery/invoice/:invoiceId ──────────────────────────────────
// Get invoice data for frontend
router.get('/invoice/:invoiceId', async (req, res) => {
  try {
    const { invoiceId } = req.params;

    const invoice = await invoiceService.getInvoiceData(invoiceId);

    res.json(invoice);
  } catch (err) {
    if (err.code === 'NOT_FOUND') {
      return res.status(404).json({ error: err.message });
    }
    if (err.code === 'VALIDATION_ERROR') {
      return res.status(400).json({ error: err.message });
    }
    res.status(500).json({ error: 'Failed to get invoice' });
  }
});

// ─── INVOICE WHATSAPP ──────────────────────────────────────────────────

// ─── GET /delivery/invoice/whatsapp/:invoiceId ─────────────────────────
// Generate WhatsApp deep link for invoice sharing (uses secure token)
router.get('/invoice/whatsapp/:invoiceId', async (req, res) => {
  try {
    const { invoiceId } = req.params;
    const { phone } = req.query;

    if (!phone) {
      return res.status(400).json({ error: 'Phone number is required (query param: phone)' });
    }

    const result = await invoiceService.getInvoiceWhatsAppLink(invoiceId, phone, req.user.userId);

    res.json(result);
  } catch (err) {
    if (err.code === 'NOT_FOUND') {
      return res.status(404).json({ error: err.message });
    }
    if (err.code === 'VALIDATION_ERROR') {
      return res.status(400).json({ error: err.message });
    }
    res.status(500).json({ error: 'Failed to generate WhatsApp link' });
  }
});

// ─── SHARE TOKEN CREATION ──────────────────────────────────────────────

// ─── POST /delivery/share/receipt/:transactionId ──────────────────────
// Create a secure share token for a receipt
router.post('/share/receipt/:transactionId', async (req, res) => {
  try {
    const { transactionId } = req.params;

    const result = await shareService.createReceiptToken(transactionId, req.user.userId);

    res.status(201).json(result);
  } catch (err) {
    if (err.code === 'NOT_FOUND') {
      return res.status(404).json({ error: err.message });
    }
    if (err.code === 'VALIDATION_ERROR') {
      return res.status(400).json({ error: err.message });
    }
    res.status(500).json({ error: 'Failed to create share link' });
  }
});

// ─── POST /delivery/share/invoice/:invoiceId ──────────────────────────
// Create a secure share token for an invoice
router.post('/share/invoice/:invoiceId', async (req, res) => {
  try {
    const { invoiceId } = req.params;

    const result = await shareService.createInvoiceToken(invoiceId, req.user.userId);

    res.status(201).json(result);
  } catch (err) {
    if (err.code === 'NOT_FOUND') {
      return res.status(404).json({ error: err.message });
    }
    if (err.code === 'VALIDATION_ERROR') {
      return res.status(400).json({ error: err.message });
    }
    res.status(500).json({ error: 'Failed to create share link' });
  }
});

// ─── DELETE /delivery/share/:token ────────────────────────────────────
// Revoke a share token
router.delete('/share/:token', async (req, res) => {
  try {
    await shareService.revokeToken(req.params.token);
    res.json({ message: 'Share link revoked' });
  } catch (err) {
    res.status(500).json({ error: 'Failed to revoke share link' });
  }
});

module.exports = router;
