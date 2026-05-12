/**
 * inv-invoice-pdf.js — 3-Pillar Irish VAT Invoice PDF Generator
 *
 * Generates A4 portrait PDF invoices using PDFKit.
 * Three tax categories: Sales (23%), Services (13.5%), Margin Scheme.
 */

const PDFDocument = require('pdfkit');
const fs = require('fs');
const path = require('path');

// ─── Company Info ──────────────────────────────────────────────────────
const COMPANY = {
  name: 'TechCross Repair Centre',
  vatNumber: 'IE3330982OH',
  address: 'UNIT M.4, Navan Town Centre',
  address2: 'Kennedy Road, Navan, Co. Meath, C15 F658',
  phone: '046 905 9854',
  mobile: '089 482 5300',
  logoPath: path.join(__dirname, '..', 'logo.png'),
  logoWidth: 175,
};

// ─── Layout constants (A4: 595 x 842 pt) ───────────────────────────────
const MARGIN = 50;
const PAGE_WIDTH = 595;
const USABLE_WIDTH = PAGE_WIDTH - 2 * MARGIN;
const RIGHT_EDGE = PAGE_WIDTH - MARGIN;

const DARK = '#1a1a1a';
const GRAY = '#495057';
const LIGHT = '#868e96';
const BORDER = '#dee2e6';

// ─── Helpers ───────────────────────────────────────────────────────────
function euro(n) {
  return '€' + (n || 0).toFixed(2);
}

function formatDate(d) {
  if (!d) return '—';
  const dt = new Date(d);
  return dt.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
}

function hr(doc, y) {
  doc.lineWidth(1).strokeColor(BORDER);
  doc.moveTo(MARGIN, y).lineTo(RIGHT_EDGE, y).stroke();
}

// ─── Group items by vatType (handles both old & new labels) ────────────
function groupItems(items) {
  const sales = [], services = [], margin = [];
  (items || []).forEach(function (item) {
    var t = item.vatType;
    if (t === 'margin')                    margin.push(item);
    else if (t === 'service' || t === 'reduced') services.push(item);
    else                                    sales.push(item);
  });
  return { sales: sales, services: services, margin: margin };
}

// ─── Section VAT calculation ───────────────────────────────────────────
function sectionCalc(items, rate) {
  var total = items.reduce(function (s, i) { return s + (i.lineTotal || 0); }, 0);
  total = Math.round(total * 100) / 100;
  if (rate === 0) return { total: total, net: total, vat: 0 };
  var net = Math.round(total / (1 + rate) * 100) / 100;
  var vat = Math.round((total - net) * 100) / 100;
  return { total: total, net: net, vat: vat };
}

// ─── HEADER ────────────────────────────────────────────────────────────
function drawHeader(doc, invoice) {
  var ci = (invoice && invoice.companyInfo) || COMPANY;
  var y = MARGIN + 10;

  // TAX INVOICE title (ONLY ONE)
  doc.font('Helvetica-Bold').fontSize(16).fillColor(DARK);
  doc.text('TAX INVOICE', MARGIN, y);

  // Logo (right side, aligned with title)
  try {
    if (fs.existsSync(COMPANY.logoPath)) {
      doc.image(COMPANY.logoPath, RIGHT_EDGE - COMPANY.logoWidth, y - 4, { width: COMPANY.logoWidth });
    }
  } catch (e) { /* skip logo */ }

  y += 28;

  // Company address block (from invoice snapshot, fallback to hardcoded)
  doc.font('Helvetica').fontSize(10).fillColor(GRAY);
  doc.text(ci.businessName || COMPANY.name, MARGIN, y);
  y += 14;
  var addr = ci.address || COMPANY.address;
  // address may include the second line — split if it contains a comma-newline pattern
  var addrParts = addr.split(', ');
  doc.text(addrParts[0], MARGIN, y);
  y += 12;
  if (addrParts.length > 1) {
    doc.text(addrParts.slice(1).join(', '), MARGIN, y);
    y += 12;
  } else {
    doc.text(COMPANY.address2, MARGIN, y);
    y += 12;
  }
  doc.text('VAT No: ' + (ci.vatNumber || COMPANY.vatNumber), MARGIN, y);
  y += 12;
  doc.text('Tel: ' + (ci.phone || COMPANY.phone) + ' | Mob/WhatsApp: ' + COMPANY.mobile, MARGIN, y);
  y += 22;

  hr(doc, y);
  y += 16;

  return y;
}

// ─── BILL TO + INVOICE INFO ───────────────────────────────────────────
function drawInvoiceInfo(doc, invoice, startY) {
  var y = startY;
  var rightColX = MARGIN + USABLE_WIDTH / 2;

  // Bill To (left)
  doc.font('Helvetica-Bold').fontSize(11).fillColor(DARK);
  doc.text('Bill To:', MARGIN, y);

  doc.font('Helvetica').fontSize(9).fillColor(GRAY);
  doc.text(invoice.customerName || 'Walk-in Customer', MARGIN, y + 16);

  var leftBottom = y + 16 + 13;
  if (invoice.customerContact) {
    doc.text(invoice.customerContact, MARGIN, leftBottom);
    leftBottom += 13;
  }

  // Invoice details (right column)
  var pmtLabels = { cash: 'Cash', card: 'Card', split: 'Split (Cash + Card)' };
  var dateStr = invoice.transactionDate
    ? formatDate(invoice.transactionDate)
    : formatDate(invoice.createdAt);

  var infoLines = [
    { label: 'Invoice No:', value: invoice.invoiceNumber },
    { label: 'Date:', value: dateStr },
    { label: 'Payment:', value: pmtLabels[invoice.paymentMethod] || invoice.paymentMethod },
  ];

  var rightBottom = y;
  for (var i = 0; i < infoLines.length; i++) {
    var line = infoLines[i];
    doc.font('Helvetica').fontSize(10).fillColor(GRAY);
    doc.text(line.label, rightColX, rightBottom, { width: 75 });
    doc.font('Helvetica-Bold').fillColor(DARK);
    doc.text(line.value, rightColX + 80, rightBottom, { width: USABLE_WIDTH / 2 - 80 });
    rightBottom += 18;
  }

  y = Math.max(leftBottom, rightBottom);
  y += 10;
  hr(doc, y);
  y += 16;

  return y;
}

// ─── SECTION RENDERER (shared by all 3 pillars) ────────────────────────
function drawSection(doc, y, title, items, vatRate, isMargin) {
  if (items.length === 0) return y;

  // Section separator
  hr(doc, y);
  y += 10;

  // Section title
  doc.font('Helvetica-Bold').fontSize(10).fillColor(DARK);
  doc.text(title, MARGIN, y);
  y += 16;

  // Column headers
  var colItem = MARGIN;
  var colQty = 310;
  var colPrice = 370;
  var colTotal = 480;

  doc.font('Helvetica-Bold').fontSize(8).fillColor(GRAY);
  doc.text('Item', colItem, y, { width: colQty - colItem });
  doc.text('Qty', colQty, y, { width: colPrice - colQty, align: 'center' });
  doc.text('Price', colPrice, y, { width: colTotal - colPrice, align: 'right' });
  doc.text('Total', colTotal, y, { width: RIGHT_EDGE - colTotal, align: 'right' });
  y += 13;

  // Item rows
  doc.font('Helvetica').fontSize(9).fillColor(DARK);
  for (var i = 0; i < items.length; i++) {
    var item = items[i];
    doc.text(item.name || '—', colItem, y, { width: colQty - colItem - 4 });
    doc.text(String(item.quantity || 1), colQty, y, { width: colPrice - colQty, align: 'center' });
    doc.text(euro(item.unitPrice), colPrice, y, { width: colTotal - colPrice, align: 'right' });
    doc.font('Helvetica-Bold');
    doc.text(euro(item.lineTotal), colTotal, y, { width: RIGHT_EDGE - colTotal, align: 'right' });
    doc.font('Helvetica');
    y += 20;
  }

  // Summary line
  var calc = sectionCalc(items, vatRate);
  var sumX = colPrice;
  var sumW = RIGHT_EDGE - sumX;

  y += 4;
  hr(doc, y);
  y += 8;

  if (isMargin) {
    // Margin: total only (no VAT)
    doc.font('Helvetica-Bold').fontSize(10).fillColor(DARK);
    doc.text('Total:', sumX, y, { width: sumW - 60, align: 'right' });
    doc.text(euro(calc.total), sumX + sumW - 60, y, { width: 60, align: 'right' });
    y += 16;

    // Margin scheme legal text
    doc.font('Helvetica-Oblique').fontSize(8).fillColor(LIGHT);
    doc.text(
      'Margin Scheme – VAT not separately disclosed under Irish legislation.',
      MARGIN, y, { width: USABLE_WIDTH }
    );
    y += 14;
  } else {
    // Sales / Service: net + VAT breakdown
    var rateLabel = vatRate === 0.23 ? '23%' : '13.5%';

    doc.font('Helvetica').fontSize(9).fillColor(GRAY);
    doc.text('Net:', sumX, y, { width: sumW - 60, align: 'right' });
    doc.text(euro(calc.net), sumX + sumW - 60, y, { width: 60, align: 'right' });
    y += 14;

    doc.text('VAT @ ' + rateLabel + ':', sumX, y, { width: sumW - 60, align: 'right' });
    doc.text(euro(calc.vat), sumX + sumW - 60, y, { width: 60, align: 'right' });
    y += 14;

    doc.font('Helvetica-Bold').fontSize(10).fillColor(DARK);
    doc.text('Section Total:', sumX, y, { width: sumW - 60, align: 'right' });
    doc.text(euro(calc.total), sumX + sumW - 60, y, { width: 60, align: 'right' });
    y += 20;
  }

  return y;
}

// ─── GRAND TOTAL ───────────────────────────────────────────────────────
function drawGrandTotal(doc, y, totals) {
  hr(doc, y);
  y += 12;

  var sumX = RIGHT_EDGE - 250;
  var sumW = 250;

  doc.font('Helvetica').fontSize(10).fillColor(GRAY);

  if (totals.sales > 0) {
    doc.text('Sales:', sumX, y, { width: sumW - 80, align: 'left' });
    doc.text(euro(totals.sales), sumX + sumW - 80, y, { width: 80, align: 'right' });
    y += 16;
  }
  if (totals.services > 0) {
    doc.text('Services:', sumX, y, { width: sumW - 80, align: 'left' });
    doc.text(euro(totals.services), sumX + sumW - 80, y, { width: 80, align: 'right' });
    y += 16;
  }
  if (totals.margin > 0) {
    doc.text('Margin Goods:', sumX, y, { width: sumW - 80, align: 'left' });
    doc.text(euro(totals.margin), sumX + sumW - 80, y, { width: 80, align: 'right' });
    y += 16;
  }

  y += 4;
  hr(doc, y);
  y += 10;

  doc.font('Helvetica-Bold').fontSize(14).fillColor(DARK);
  doc.text('TOTAL PAYABLE:', sumX, y, { width: sumW - 80, align: 'left' });
  doc.text(euro(totals.total), sumX + sumW - 80, y, { width: 80, align: 'right' });
  y += 30;

  return y;
}

// ─── FOOTER ────────────────────────────────────────────────────────────
function drawFooter(doc) {
  var pageH = doc.page.height;
  var y = pageH - MARGIN - 100;

  if (doc.y > y) {
    doc.addPage();
    y = MARGIN + 20;
  }

  hr(doc, y);
  y += 16;

  doc.font('Helvetica-Bold').fontSize(10).fillColor(DARK);
  doc.text('Thank you for choosing TechCross Repair Centre.', MARGIN, y, { align: 'center', width: USABLE_WIDTH });
  y += 14;

  doc.font('Helvetica').fontSize(9).fillColor(GRAY);
  doc.text(
    'We appreciate your business and hope you are satisfied with our service. If you have any questions',
    MARGIN, y, { align: 'center', width: USABLE_WIDTH }
  );
  y += 12;
  doc.text(
    'regarding this invoice or your device, please do not hesitate to contact us via phone or WhatsApp.',
    MARGIN, y, { align: 'center', width: USABLE_WIDTH }
  );
  y += 20;

  doc.fontSize(8).fillColor(LIGHT);
  doc.text(
    'This is a computer-generated invoice and does not require a signature.',
    MARGIN, y, { align: 'center', width: USABLE_WIDTH }
  );
}

// ─── MAIN GENERATE ─────────────────────────────────────────────────────
async function generate(invoice) {
  return new Promise(function (resolve, reject) {
    var doc = new PDFDocument({
      size: 'A4',
      margin: MARGIN,
      info: {
        Title: 'VAT Invoice - ' + (invoice.invoiceNumber || ''),
        Author: (invoice.companyInfo && invoice.companyInfo.businessName) || COMPANY.name,
        Subject: 'VAT Invoice',
        Keywords: 'invoice, vat, techcross',
      },
    });

    var chunks = [];
    doc.on('data', function (c) { chunks.push(c); });
    doc.on('end', function () { resolve(Buffer.concat(chunks)); });
    doc.on('error', reject);

    try {
      var y = drawHeader(doc, invoice);
      y = drawInvoiceInfo(doc, invoice, y);

      var groups = groupItems(invoice.items);
      y = drawSection(doc, y, 'SALES (23% VAT)', groups.sales, 0.23, false);
      y = drawSection(doc, y, 'REPAIRS / SERVICES (13.5% VAT)', groups.services, 0.135, false);
      y = drawSection(doc, y, 'SECOND-HAND GOODS (MARGIN SCHEME)', groups.margin, 0, true);

      var totalSales = groups.sales.reduce(function (s, i) { return s + (i.lineTotal || 0); }, 0);
      var totalServices = groups.services.reduce(function (s, i) { return s + (i.lineTotal || 0); }, 0);
      var totalMargin = groups.margin.reduce(function (s, i) { return s + (i.lineTotal || 0); }, 0);

      y = drawGrandTotal(doc, y, {
        sales: Math.round(totalSales * 100) / 100,
        services: Math.round(totalServices * 100) / 100,
        margin: Math.round(totalMargin * 100) / 100,
        total: Math.round((totalSales + totalServices + totalMargin) * 100) / 100,
      });

      drawFooter(doc);
    } catch (err) {
      reject(err);
      return;
    }

    doc.end();
  });
}

module.exports = { generate };
