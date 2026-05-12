/**
 * Tech Cross Print Agent
 *
 * Standalone Node.js application that runs on the till computer.
 * Receives receipt data via HTTP POST and prints to an 80mm thermal
 * printer using ESC/POS commands.
 *
 * Endpoints:
 *   POST /print   — Print a receipt
 *   GET  /status  — Printer connection status
 *
 * Connection priority: network first, USB fallback.
 */

const express = require('express');
const cors = require('cors');
const path = require('path');
const fs = require('fs');
const sharp = require('sharp');

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

const configPath = path.join(__dirname, 'config.json');
let config;
try {
  config = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
} catch (err) {
  console.error('Failed to read config.json:', err.message);
  process.exit(1);
}

const PORT = config.port || 9100;
const LOGO_PATH = path.resolve(__dirname, config.logoPath || '../logo.png');

// ---------------------------------------------------------------------------
// Print log helpers
// ---------------------------------------------------------------------------

const printLogs = [];

function logPrint(receiptNumber, success, error) {
  const entry = {
    time: new Date().toISOString(),
    receiptNumber: receiptNumber || 'unknown',
    success,
    error: error || null,
  };
  printLogs.push(entry);
  // Keep only the last 500 entries in memory
  if (printLogs.length > 500) printLogs.shift();
  const status = success ? 'OK' : 'FAIL';
  console.log(`[PRINT ${status}] ${entry.time} — Receipt: ${entry.receiptNumber}${error ? ' — ' + error : ''}`);
}

// ---------------------------------------------------------------------------
// Logo bitmap conversion (sharp → ESC/POS raster)
// ---------------------------------------------------------------------------

let cachedLogoBitmap = null;

/**
 * Convert the company logo PNG to a monochrome bitmap buffer suitable for
 * ESC/POS raster printing. The image is resized to fit 80mm paper width
 * (max ~384 dots at 203 DPI). Result is cached after first conversion.
 *
 * @returns {Promise<Buffer|null>} Raw pixel buffer or null on failure
 */
async function getLogoBitmap() {
  if (cachedLogoBitmap) return cachedLogoBitmap;

  try {
    if (!fs.existsSync(LOGO_PATH)) {
      console.warn('Logo file not found at', LOGO_PATH);
      return null;
    }

    const image = sharp(LOGO_PATH)
      .resize({ width: 384, fit: 'inside' })
      .greyscale()
      .threshold(128)
      .raw();

    const { data, info } = await image.toBuffer({ resolveWithObject: true });
    cachedLogoBitmap = { data, width: info.width, height: info.height };
    return cachedLogoBitmap;
  } catch (err) {
    console.error('Logo conversion error:', err.message);
    return null;
  }
}

// ---------------------------------------------------------------------------
// Side-by-side QR code image (two local PNG files merged into one raster)
// ---------------------------------------------------------------------------

const QR_SALES_PATH = path.join(__dirname, 'qr-sales-tc.png');
const QR_REPAIR_PATH = path.join(__dirname, 'qr-repair-tc.png');
let cachedQrImage = null;

/**
 * Merge the two local QR code PNGs into a single side-by-side monochrome
 * image for ESC/POS raster printing. Cached after first call.
 *
 * @returns {Promise<{data: Buffer, width: number, height: number}|null>}
 */
async function getSideBySideQrImage() {
  if (cachedQrImage) return cachedQrImage;

  try {
    if (!fs.existsSync(QR_SALES_PATH) || !fs.existsSync(QR_REPAIR_PATH)) {
      console.warn('QR code PNG files not found');
      return null;
    }

    const qrSize = 160;
    const gap = 24;
    const totalWidth = qrSize * 2 + gap; // 344px — fits 384 dot width

    const leftBuf = await sharp(QR_SALES_PATH).resize(qrSize, qrSize).greyscale().toBuffer();
    const rightBuf = await sharp(QR_REPAIR_PATH).resize(qrSize, qrSize).greyscale().toBuffer();

    const { data, info } = await sharp({
      create: { width: totalWidth, height: qrSize, channels: 1, background: 255 }
    })
      .composite([
        { input: leftBuf, left: 0, top: 0 },
        { input: rightBuf, left: qrSize + gap, top: 0 },
      ])
      .greyscale()
      .threshold(128)
      .raw()
      .toBuffer({ resolveWithObject: true });

    cachedQrImage = { data, width: info.width, height: info.height };
    return cachedQrImage;
  } catch (err) {
    console.error('QR image merge error:', err.message);
    return null;
  }
}

// ---------------------------------------------------------------------------
// Printer connection helpers
// ---------------------------------------------------------------------------

/**
 * Attempt to open a network printer connection.
 * @returns {Promise<{device: object, type: string}>}
 */
function openNetworkPrinter() {
  return new Promise((resolve, reject) => {
    try {
      const escpos = require('escpos');
      require('escpos-network');

      const device = new escpos.Network(config.printer.host, config.printer.port || 9100);
      device.open((err) => {
        if (err) return reject(err);
        resolve({ device, type: 'network' });
      });
    } catch (err) {
      reject(err);
    }
  });
}

/**
 * Attempt to open a USB printer connection (fallback).
 * @returns {Promise<{device: object, type: string}>}
 */
function openUSBPrinter() {
  return new Promise((resolve, reject) => {
    try {
      const escpos = require('escpos');
      require('escpos-usb');

      const vid = parseInt(config.usbFallback.vendorId, 16);
      const pid = parseInt(config.usbFallback.productId, 16);
      const device = new escpos.USB(vid, pid);
      device.open((err) => {
        if (err) return reject(err);
        resolve({ device, type: 'usb' });
      });
    } catch (err) {
      reject(err);
    }
  });
}

/**
 * Open a printer connection — tries network first, then USB fallback.
 * @returns {Promise<{device: object, type: string}>}
 */
async function openPrinter() {
  try {
    return await openNetworkPrinter();
  } catch (netErr) {
    console.warn('Network printer unavailable, trying USB fallback…', netErr.message);
    return await openUSBPrinter();
  }
}

// ---------------------------------------------------------------------------
// Receipt printing logic
// ---------------------------------------------------------------------------

/**
 * Format a currency value as €X.XX
 */
function eur(amount) {
  return '€' + Number(amount || 0).toFixed(2);
}

/**
 * Print a receipt using ESC/POS commands.
 *
 * @param {object} receipt - Structured receipt data (from inv-receipt-generator)
 * @returns {Promise<{success: boolean, connectionType: string}>}
 */
async function printReceipt(receipt) {
  const escpos = require('escpos');
  const { device, type: connectionType } = await openPrinter();
  const printer = new escpos.Printer(device);

  return new Promise((resolve, reject) => {
    try {
      // --- Logo ---
      printer.align('CT');

      // We print the logo asynchronously before the rest of the receipt.
      // If the logo is unavailable we simply skip it.
      const logoPrintPromise = (async () => {
        try {
          const logo = await getLogoBitmap();
          if (logo) {
            // Use escpos raster method if available, otherwise skip
            const escposImage = new escpos.Image(logo.data, logo.width, logo.height);
            printer.raster(escposImage);
          }
        } catch (_) {
          // Logo printing is best-effort
        }
      })();

      // Wait for logo then continue with text
      logoPrintPromise.then(() => {
        // --- Company header ---
        printer
          .align('CT')
          .style('B')
          .size(2, 2)
          .text(receipt.companyName || 'Tech Cross')
          .size(1, 1)
          .style('NORMAL')
          .text(receipt.companyAddress || '')
          .text('Tel: ' + (receipt.companyPhone || ''))
          .drawLine();

        // --- Receipt number & date ---
        printer
          .align('LT')
          .text('Receipt: ' + (receipt.receiptNumber || ''))
          .text('Date:    ' + (receipt.date || ''));

        printer.drawLine();

        // --- Items table ---
        printer
          .align('LT')
          .style('B')
          .text('Item                 Qty   Price  Subtotal')
          .style('NORMAL')
          .drawLine();

        const items = receipt.items || [];
        items.forEach((item) => {
          const name = (item.name || '').substring(0, 20).padEnd(20);
          const qty = String(item.quantity || 1).padStart(3);
          const price = eur(item.discountedPrice != null ? item.discountedPrice : item.unitPrice).padStart(8);
          const subtotal = eur(item.subtotal).padStart(9);
          printer.text(`${name} ${qty} ${price} ${subtotal}`);

          // Show serial number for second-hand items
          if (item.serialNumber) {
            printer.text(`  SN: ${item.serialNumber}`);
          }
        });

        printer.drawLine();

        // --- Discount info ---
        const discountInfo = receipt.discountInfo || {};
        const itemDiscounts = discountInfo.itemDiscounts || [];
        if (itemDiscounts.length > 0) {
          printer.style('B').text('Discounts:').style('NORMAL');
          itemDiscounts.forEach((d) => {
            const label = d.discountType === 'percentage'
              ? `${d.discountValue}% off`
              : `${eur(d.discountValue)} off`;
            printer.text(`  ${(d.itemName || '').substring(0, 18)}: ${label}`);
          });
        }

        if (discountInfo.orderDiscount) {
          const od = discountInfo.orderDiscount;
          const label = od.discountType === 'percentage'
            ? `${od.discountValue}% off order`
            : `${eur(od.discountValue)} off order`;
          printer.text('Order discount: ' + label);
        }

        if (itemDiscounts.length > 0 || discountInfo.orderDiscount) {
          printer.drawLine();
        }

        // --- Totals ---
        printer
          .align('RT')
          .style('B')
          .size(1, 1)
          .text('TOTAL: ' + eur(receipt.totalAmount))
          .size(1, 1)
          .style('NORMAL');

        // Payment method
        const method = (receipt.paymentMethod || 'cash').toUpperCase();
        printer.align('LT').text('Payment: ' + method);

        if (receipt.paymentMethod === 'cash') {
          if (receipt.cashReceived != null) {
            printer.text('Cash received: ' + eur(receipt.cashReceived));
          }
          if (receipt.changeGiven != null) {
            printer.text('Change:        ' + eur(receipt.changeGiven));
          }
        }

        printer.drawLine();

        // --- VAT breakdown ---
        if (receipt.standardVatTotal > 0) {
          printer.text('Standard VAT (23%): ' + eur(receipt.standardVatTotal));
        }
        if (receipt.marginVatTotal > 0) {
          printer.text('Margin Scheme VAT:  ' + eur(receipt.marginVatTotal));
        }
        if (receipt.standardVatTotal > 0 || receipt.marginVatTotal > 0) {
          printer.drawLine();
        }

        // --- Terms & Conditions ---
        printer
          .align('CT')
          .style('NORMAL')
          .size(1, 1);

        if (receipt.termsText) {
          printer.text(receipt.termsText);
        }

        // Second-hand T&C
        if (receipt.hasSecondHandItems && receipt.secondHandTermsText) {
          printer.text('');
          printer.text(receipt.secondHandTermsText);
        }

        printer.text('');

        // --- QR codes side by side as a single raster image ---
        if (receipt.repairTcUrl && receipt.qrCodeUrl) {
          printer.align('CT');
          printer.style('B').text('Scan for T&C:').style('NORMAL');
          printer.text(' Sales T&C        Repair T&C');

          try {
            const qrImg = await getSideBySideQrImage();
            if (qrImg) {
              const escposImage = new escpos.Image(qrImg.data, qrImg.width, qrImg.height);
              printer.raster(escposImage);
            }
          } catch (_) { /* QR printing is best-effort */ }

          printer.text('');
          printer.style('B').text('Thank you!').style('NORMAL');
          printer.cut().close();
          resolve({ success: true, connectionType });
        } else if (receipt.qrCodeUrl) {
          printer.align('CT');
          printer.text('Sales T&C:');
          printer.qrimage(receipt.qrCodeUrl, { type: 'png', mode: 'dpi', size: 4 }, () => {
            printer.style('B').text('Thank you!').style('NORMAL');
            printer.cut().close();
            resolve({ success: true, connectionType });
          });
        } else if (receipt.repairTcUrl) {
          printer.align('CT');
          printer.text('Repair T&C:');
          printer.qrimage(receipt.repairTcUrl, { type: 'png', mode: 'dpi', size: 4 }, () => {
            printer.style('B').text('Thank you!').style('NORMAL');
            printer.cut().close();
            resolve({ success: true, connectionType });
          });
        } else {
          printer.align('CT');
          printer.style('B').text('Thank you!').style('NORMAL');
          printer.cut().close();
          resolve({ success: true, connectionType });
        }
      }).catch((err) => {
        try { printer.close(); } catch (_) { /* ignore */ }
        reject(err);
      });
    } catch (err) {
      try { device.close(); } catch (_) { /* ignore */ }
      reject(err);
    }
  });
}

// ---------------------------------------------------------------------------
// Express server
// ---------------------------------------------------------------------------

const app = express();

// CORS — allow requests from localhost origins (POS page in browser)
app.use(cors({
  origin: (origin, callback) => {
    // Allow requests with no origin (curl, Postman) or from localhost
    if (!origin || /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin)) {
      callback(null, true);
    } else {
      callback(new Error('Not allowed by CORS'));
    }
  },
}));

app.use(express.json({ limit: '2mb' }));

// ---------------------------------------------------------------------------
// POST /print — Receive receipt data and print
// ---------------------------------------------------------------------------

app.post('/print', async (req, res) => {
  const receipt = req.body;

  if (!receipt || typeof receipt !== 'object') {
    return res.status(400).json({ success: false, error: 'Invalid receipt data' });
  }

  try {
    const result = await printReceipt(receipt);
    logPrint(receipt.receiptNumber, true);
    return res.json({
      success: true,
      connectionType: result.connectionType,
      receiptNumber: receipt.receiptNumber,
    });
  } catch (err) {
    logPrint(receipt.receiptNumber, false, err.message);
    return res.status(500).json({
      success: false,
      error: 'Print failed: ' + err.message,
      receiptNumber: receipt.receiptNumber,
    });
  }
});

// ---------------------------------------------------------------------------
// GET /status — Printer connection status
// ---------------------------------------------------------------------------

app.get('/status', async (_req, res) => {
  // Attempt to open and immediately close a connection to check availability
  let connectionType = null;
  let connected = false;
  let error = null;

  try {
    const { device, type } = await openPrinter();
    connectionType = type;
    connected = true;
    try { device.close(); } catch (_) { /* ignore */ }
  } catch (err) {
    error = err.message;
  }

  return res.json({
    connected,
    connectionType,
    printerConfig: {
      type: config.printer.type,
      host: config.printer.host,
      port: config.printer.port,
    },
    usbFallback: config.usbFallback,
    error,
    recentLogs: printLogs.slice(-20),
  });
});

// ---------------------------------------------------------------------------
// Start server
// ---------------------------------------------------------------------------

app.listen(PORT, '127.0.0.1', () => {
  console.log(`Tech Cross Print Agent running on http://127.0.0.1:${PORT}`);
  console.log(`  POST /print   — Send receipt data to print`);
  console.log(`  GET  /status  — Check printer connection`);
  console.log(`  Printer: ${config.printer.type} @ ${config.printer.host}:${config.printer.port}`);
  console.log(`  USB fallback: VID=${config.usbFallback.vendorId} PID=${config.usbFallback.productId}`);
});
