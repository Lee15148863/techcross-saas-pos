/**
 * share-public.js — Public Share Routes
 *
 * These routes are PUBLIC (no auth required).
 * Serves mobile-first HTML pages for shared receipts/invoices,
 * JSON data endpoints for client-side rendering,
 * and direct PDF download for invoices.
 *
 * Mounted at /share in server.js
 * No raw DB IDs are exposed in any URL.
 */

const path = require('path');
const express = require('express');
const router = express.Router();
const rateLimit = require('express-rate-limit');
const shareService = require('../../services/inv-share-service');
const pdfGenerator = require('../../services/inv-invoice-pdf');

const ROOT = path.join(__dirname, '..', '..');

const shareLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 60,
  message: { error: 'Too many requests, please try again later.' },
  standardHeaders: true,
  legacyHeaders: false,
});

const pdfLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 20,
  message: { error: 'Too many PDF requests, please try again later.' },
  standardHeaders: true,
  legacyHeaders: false,
});

router.use(shareLimiter);

// Override with stricter limit for PDF generation (resource intensive)
router.use('/invoice/:token/pdf', pdfLimiter);

// ─── Serve HTML pages ──────────────────────────────────────────────────
router.get('/receipt/:token', function (req, res) {
  res.sendFile(path.join(ROOT, 'share-receipt.html'));
});

router.get('/invoice/:token', function (req, res) {
  res.sendFile(path.join(ROOT, 'share-invoice.html'));
});

// ─── Receipt data (JSON) ───────────────────────────────────────────────
// Used by share-receipt.html client-side JS
router.get('/receipt/:token/data', async (req, res) => {
  try {
    const result = await shareService.getShareData(req.params.token);
    if (result.type !== 'receipt') {
      return res.status(404).json({ error: 'Not found' });
    }

    // Return receipt data (no DB IDs in response)
    const txn = result.transaction;
    res.json({
      transaction: {
        receiptNumber: txn.receiptNumber,
        totalAmount: txn.totalAmount,
        paymentMethod: txn.paymentMethod,
        cashReceived: txn.cashReceived,
        cardAmount: txn.cardAmount,
        changeGiven: txn.changeGiven,
        standardVatTotal: txn.standardVatTotal,
        marginVatTotal: txn.marginVatTotal,
        createdAt: txn.createdAt,
        items: (txn.items || []).map(function (item) {
          return {
            name: item.name,
            quantity: item.quantity,
            unitPrice: item.unitPrice,
            discountedPrice: item.discountedPrice,
            serialNumber: item.serialNumber,
            subtotal: item.subtotal,
          };
        }),
      },
      accessCount: result.accessCount,
    });
  } catch (err) {
    if (err.code === 'EXPIRED') {
      return res.status(410).json({ error: err.message });
    }
    res.status(404).json({ error: 'Not found' });
  }
});

// ─── Invoice data (JSON) ───────────────────────────────────────────────
// Used by share-invoice.html client-side JS
router.get('/invoice/:token/data', async (req, res) => {
  try {
    const result = await shareService.getShareData(req.params.token);
    if (result.type !== 'invoice') {
      return res.status(404).json({ error: 'Not found' });
    }

    const inv = result.invoice;
    res.json({
      invoice: {
        invoiceNumber: inv.invoiceNumber,
        receiptNumber: inv.receiptNumber,
        grossTotal: inv.grossTotal,
        subtotalExVat: inv.subtotalExVat,
        standardVatTotal: inv.standardVatTotal,
        reducedVatTotal: inv.reducedVatTotal,
        marginVatTotal: inv.marginVatTotal,
        hasMarginItems: inv.hasMarginItems,
        paymentMethod: inv.paymentMethod,
        transactionDate: inv.transactionDate,
        customerName: inv.customerName,
        companyInfo: inv.companyInfo,
        items: (inv.items || []).map(function (item) {
          return {
            name: item.name,
            quantity: item.quantity,
            unitPrice: item.unitPrice,
            vatType: item.vatType,
            lineTotal: item.lineTotal,
          };
        }),
      },
      accessCount: result.accessCount,
    });
  } catch (err) {
    if (err.code === 'EXPIRED') {
      return res.status(410).json({ error: err.message });
    }
    res.status(404).json({ error: 'Not found' });
  }
});

// ─── Invoice PDF (inline) ──────────────────────────────────────────────
// Returns PDF for direct viewing/download
router.get('/invoice/:token/pdf', async (req, res) => {
  try {
    const result = await shareService.getShareData(req.params.token);
    if (result.type !== 'invoice') {
      return res.status(404).json({ error: 'Not found' });
    }

    const pdfBuffer = await pdfGenerator.generate(result.invoice);

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', 'inline; filename*=UTF-8\'\'' + encodeURIComponent(result.invoice.invoiceNumber) + '.pdf');
    res.send(pdfBuffer);
  } catch (err) {
    if (err.code === 'EXPIRED') {
      // Return HTML for expired link (browsers opening PDF directly)
      res.status(410).type('html').send(expiredPage());
      return;
    }
    res.status(404).json({ error: 'Not found' });
  }
});

function expiredPage() {
  var cName = process.env.COMPANY_NAME || 'TechCross Repair Centre';
  var cLoc = process.env.COMPANY_ADDRESS || 'Navan, Co. Meath, Ireland';
  return '<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1.0"><title>Expired</title><style>body{font-family:-apple-system,BlinkMacSystemFont,sans-serif;background:#f5f5f7;display:flex;align-items:center;justify-content:center;min-height:100vh;margin:0;}.card{background:#fff;border-radius:20px;padding:48px 32px;max-width:400px;width:88%;text-align:center;}.icon{font-size:56px;margin-bottom:20px;}h1{font-size:22px;margin-bottom:12px;}p{color:#6e6e73;line-height:1.6;}.brand{color:#1E7F5C;font-weight:600;}</style></head><body><div class="card"><div class="icon">⏰</div><h1>This link has expired.</h1><p>Please contact ' + cName + ' for a new link or visit us in store.</p><p style="margin-top:16px;font-size:13px;"><span class="brand">' + cName + '</span><br>' + cLoc + '</p></div></body></html>';
}

module.exports = router;
