/**
 * Tech Cross Universal Print Agent (Windows)
 *
 * Auto-detects thermal printer on LAN via port 9100 scan.
 * Receives receipt data via HTTP POST and sends ESC/POS commands.
 *
 * Endpoints:
 *   POST /print   — Print receipt (structured JSON or plain text)
 *   GET  /status  — Printer IP, connection state, recent logs
 */

const express = require('express');
const cors = require('cors');
const net = require('net');
const path = require('path');
const fs = require('fs');

// ─── Config ─────────────────────────────────────────────────
const configPath = path.join(__dirname, 'config.json');
let config;
try {
  config = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
} catch (e) {
  config = { port: 9100, printer: { ip: 'AUTO', port: 9100, scanRanges: ['192.168.1'], scanTimeout: 300, rescanInterval: 60000 }, paperWidth: 48 };
}

const PORT = config.port || 9100;
const PRINTER_PORT = (config.printer && config.printer.port) || 9100;
const SCAN_RANGES = (config.printer && config.printer.scanRanges) || ['192.168.1'];
const SCAN_TIMEOUT = (config.printer && config.printer.scanTimeout) || 300;
const RESCAN_INTERVAL = (config.printer && config.printer.rescanInterval) || 60000;
const PAPER_WIDTH = config.paperWidth || 54;

let detectedIp = (config.printer && config.printer.ip !== 'AUTO') ? config.printer.ip : null;
let lastScanTime = 0;
const printLogs = [];

function log(msg) {
  const ts = new Date().toLocaleString('en-IE');
  console.log(`[${ts}] ${msg}`);
}

function addLog(receipt, success, error) {
  const entry = { time: new Date().toISOString(), receipt: receipt || '-', success, error: error || null };
  printLogs.push(entry);
  if (printLogs.length > 200) printLogs.shift();
  log((success ? '✅' : '❌') + ' Print ' + entry.receipt + (error ? ' — ' + error : ''));
}

// ─── Printer Scanner ────────────────────────────────────────
function scanPrinter() {
  return new Promise((resolve) => {
    log('🔍 Scanning for thermal printer on port ' + PRINTER_PORT + '...');
    let found = null;
    let pending = 0;
    let resolved = false;

    function done(ip) {
      if (resolved) return;
      resolved = true;
      if (ip) {
        detectedIp = ip;
        lastScanTime = Date.now();
        log('✅ Printer found: ' + ip);
      } else {
        log('⚠️  No printer found on scanned ranges');
      }
      resolve(ip);
    }

    SCAN_RANGES.forEach(function(range) {
      for (let i = 1; i < 255; i++) {
        pending++;
        var ip = range + '.' + i;
        (function(testIp) {
          var sock = new net.Socket();
          sock.setTimeout(SCAN_TIMEOUT);
          sock.connect(PRINTER_PORT, testIp, function() {
            if (!found) {
              found = testIp;
              done(testIp);
            }
            sock.destroy();
          });
          sock.on('error', function() { sock.destroy(); });
          sock.on('timeout', function() { sock.destroy(); });
          sock.on('close', function() {
            pending--;
            if (pending <= 0 && !resolved) done(found);
          });
        })(ip);
      }
    });

    // Safety timeout
    setTimeout(function() { if (!resolved) done(found); }, SCAN_RANGES.length * 255 * SCAN_TIMEOUT + 2000);
  });
}

// ─── ESC/POS Helpers ────────────────────────────────────────
var ESC = '\x1B';
var GS = '\x1D';

function escInit()    { return ESC + '@'; }           // Initialize printer
function escCenter()  { return ESC + 'a\x01'; }       // Center align
function escLeft()    { return ESC + 'a\x00'; }       // Left align
function escRight()   { return ESC + 'a\x02'; }       // Right align
function escBold(on)  { return ESC + 'E' + (on ? '\x01' : '\x00'); }
function escBig()     { return GS + '!' + '\x11'; }   // Double width+height
function escNormal()  { return GS + '!' + '\x00'; }   // Normal size
function escCut()     { return GS + 'V\x00'; }        // Full cut
function escFeed(n)   { return ESC + 'd' + String.fromCharCode(n || 3); }
function escLine()    { return '-'.repeat(PAPER_WIDTH) + '\n'; }

function padRight(s, len) { s = s || ''; return s.length >= len ? s.substring(0, len) : s + ' '.repeat(len - s.length); }
function padLeft(s, len)  { s = s || ''; return s.length >= len ? s.substring(0, len) : ' '.repeat(len - s.length) + s; }
function eur(v) { return '\x80' + Number(v || 0).toFixed(2); } // € sign in CP437

// ─── Build ESC/POS receipt from structured data ─────────────
function buildEscPosReceipt(r) {
  var buf = '';
  buf += escInit();

  // Header
  buf += escCenter();
  buf += escBold(true) + escBig();
  buf += (r.companyName || 'Tech Cross') + '\n';
  buf += escNormal() + escBold(false);
  buf += (r.companyAddress || '') + '\n';
  if (r.companyPhone) buf += 'Tel: ' + r.companyPhone + '\n';
  buf += escLine();

  // Receipt info
  buf += escLeft();
  buf += 'Receipt: ' + (r.receiptNumber || '-') + '\n';
  buf += 'Date:    ' + (r.date || new Date().toLocaleString('en-IE')) + '\n';
  buf += escLine();

  // Items
  var items = r.items || [];
  items.forEach(function(item) {
    var price = (item.discountedPrice != null ? item.discountedPrice : item.unitPrice) || 0;
    var qty = item.quantity || 1;
    var subtotal = price * qty;
    var name = (qty > 1 ? qty + 'x ' : '') + (item.name || '');
    buf += padRight(name, PAPER_WIDTH - 10) + padLeft(eur(subtotal), 10) + '\n';
    if (item.serialNumber) buf += '  SN: ' + item.serialNumber + '\n';
  });
  buf += escLine();

  // Total
  buf += escRight() + escBold(true) + escBig();
  buf += 'TOTAL ' + eur(r.totalAmount) + '\n';
  buf += escNormal() + escBold(false);

  // Payment
  buf += escLeft();
  var pm = (r.paymentMethod || 'cash');
  if (pm === 'split') {
    buf += 'Card: ' + eur(r.cardAmount) + '\n';
    buf += 'Cash: ' + eur(r.cashReceived) + '\n';
  } else if (pm === 'cash') {
    buf += 'Payment: Cash\n';
    if (r.cashReceived) buf += 'Received: ' + eur(r.cashReceived) + '\n';
  } else {
    buf += 'Payment: Card\n';
  }
  if (r.changeGiven > 0) buf += escBold(true) + 'Change: ' + eur(r.changeGiven) + '\n' + escBold(false);
  buf += escLine();

  // VAT
  if (r.standardVatTotal > 0) buf += 'VAT 23%:     ' + eur(r.standardVatTotal) + '\n';
  if (r.marginVatTotal > 0)   buf += 'Margin VAT:  ' + eur(r.marginVatTotal) + '\n';
  if (r.standardVatTotal > 0 || r.marginVatTotal > 0) buf += escLine();

  // Repair info
  if (r.repairInfo) {
    var ri = r.repairInfo;
    buf += escCenter() + escBold(true) + 'REPAIR DETAILS\n' + escBold(false) + escLeft();
    buf += '[' + (ri.orderTypeLabel || ri.orderType || 'PAID') + ']\n';
    if (ri.fault) buf += 'Fault: ' + ri.fault + '\n';
    if (ri.condition) buf += 'Condition: ' + ri.condition + '\n';
    if (ri.testStatus) buf += 'Test: ' + ri.testStatus + '\n';
    if (ri.notes) buf += 'Notes: ' + ri.notes + '\n';
    buf += escLine();
  }

  // T&C
  buf += escCenter();
  buf += escBold(true);
  buf += 'Warranty & Store Policy\n';
  buf += escBold(false);
  buf += escLeft();
  buf += 'Repairs - 3 Months\n';
  buf += 'Accessories - 14 Days\n';
  buf += escLine();

  // QR code labels (side by side)
  buf += escCenter();
  buf += escBold(true);
  buf += 'Scan for T&C:\n';
  buf += escBold(false);
  buf += '  Sales T&C      Repair T&C\n';
  buf += escLine();

  // Footer
  buf += escCenter() + escBold(true);
  buf += 'Thank you!\n';
  buf += escBold(false);

  // Feed and cut
  buf += escFeed(4);
  buf += escCut();

  return buf;
}

// ─── Build ESC/POS from plain text ──────────────────────────
function buildEscPosText(text) {
  var buf = '';
  buf += escInit();
  buf += escLeft();
  buf += text + '\n';
  buf += escFeed(4);
  buf += escCut();
  return buf;
}

// ─── Send to printer via TCP ────────────────────────────────
function sendToPrinter(data, ip) {
  return new Promise(function(resolve, reject) {
    var sock = new net.Socket();
    sock.setTimeout(10000);
    sock.connect(PRINTER_PORT, ip, function() {
      sock.write(Buffer.from(data, 'binary'), function() {
        sock.end();
        resolve();
      });
    });
    sock.on('error', function(err) { sock.destroy(); reject(err); });
    sock.on('timeout', function() { sock.destroy(); reject(new Error('Printer timeout')); });
  });
}

// ─── Express Server ─────────────────────────────────────────
const app = express();
app.use(cors());
app.use(express.json({ limit: '2mb' }));

// POST /print
app.post('/print', async function(req, res) {
  // Re-scan if no printer or stale (>60s)
  if (!detectedIp || (Date.now() - lastScanTime > RESCAN_INTERVAL)) {
    await scanPrinter();
  }
  if (!detectedIp) {
    addLog(null, false, 'No printer found');
    return res.status(500).json({ success: false, error: 'No printer detected. Check printer is on and connected to network.' });
  }

  try {
    var body = req.body;
    var escData;
    var receiptId = '-';

    if (body.content && typeof body.content === 'string') {
      // Plain text mode
      escData = buildEscPosText(body.content);
      receiptId = 'text';
    } else if (body.transaction) {
      // Transaction object from POS reprint
      var txn = body.transaction;
      receiptId = txn.receiptNumber || '-';
      escData = buildEscPosReceipt({
        companyName: 'Tech Cross Repair Centre',
        companyAddress: 'Unit 4, Navan Shopping Centre\nNavan, Co. Meath, C15 F658',
        companyPhone: '046 905 9854',
        receiptNumber: txn.receiptNumber,
        date: new Date(txn.createdAt).toLocaleString('en-IE'),
        items: txn.items,
        totalAmount: txn.totalAmount,
        paymentMethod: txn.paymentMethod,
        cardAmount: txn.cardAmount,
        cashReceived: txn.cashReceived,
        changeGiven: txn.changeGiven,
        standardVatTotal: txn.standardVatTotal,
        marginVatTotal: txn.marginVatTotal
      });
    } else if (body.receiptNumber || body.items) {
      // Structured receipt data from checkout
      receiptId = body.receiptNumber || '-';
      escData = buildEscPosReceipt(body);
    } else {
      addLog(null, false, 'Invalid data format');
      return res.status(400).json({ success: false, error: 'Send { content: "text" } or structured receipt JSON' });
    }

    await sendToPrinter(escData, detectedIp);
    addLog(receiptId, true);
    res.json({ success: true, printer: detectedIp, receiptNumber: receiptId });

  } catch (err) {
    // Printer might have gone offline, clear IP to force rescan next time
    addLog(req.body.receiptNumber || '-', false, err.message);
    detectedIp = null;
    res.status(500).json({ success: false, error: 'Print failed: ' + err.message, hint: 'Will rescan on next attempt' });
  }
});

// GET /status
app.get('/status', function(req, res) {
  res.json({
    connected: !!detectedIp,
    printerIp: detectedIp || null,
    printerPort: PRINTER_PORT,
    scanRanges: SCAN_RANGES,
    lastScan: lastScanTime ? new Date(lastScanTime).toISOString() : null,
    recentLogs: printLogs.slice(-20)
  });
});

// GET /rescan — force rescan
app.get('/rescan', async function(req, res) {
  detectedIp = null;
  await scanPrinter();
  res.json({ printerIp: detectedIp || null });
});

// ─── Start ──────────────────────────────────────────────────
(async function() {
  await scanPrinter();
  app.listen(PORT, '0.0.0.0', function() {
    log('========================================');
    log('  Tech Cross Print Agent v1.0');
    log('  http://localhost:' + PORT);
    log('  Printer: ' + (detectedIp || 'NOT FOUND — will retry'));
    log('========================================');
  });
})();
