const mongoose = require('mongoose');

/**
 * Invoice Schema — Production VAT Invoice
 *
 * This is a READ-ONLY snapshot of a Transaction at the time of invoice generation.
 * All financial values are COPIED from the Transaction — NO recalculation.
 *
 * Schema is designed for Ireland VAT compliance including Margin Scheme rules.
 */
const InvoiceSchema = new mongoose.Schema({
  // ─── Identity ──────────────────────────────────────────────────────────
  invoiceNumber:  { type: String, required: true, unique: true },
  // Format: "INV-" + receiptNumber  (e.g. "INV-S-20260507123000-A1B2")

  transaction:    { type: mongoose.Schema.Types.ObjectId, ref: 'Transaction', required: true, index: true },
  receiptNumber:  { type: String, required: true },
  // Denormalized from Transaction for query performance

  // ─── Timestamps ────────────────────────────────────────────────────────
  createdAt:       { type: Date, default: Date.now },
  // Timestamp of invoice generation
  transactionDate: { type: Date, required: true },
  // Timestamp of original transaction (Transaction.createdAt)

  // ─── Business Legal Header — SNAPSHOT at generation time ────────────────
  // Immutable once set. Prevents legal entity changes from retroactively
  // altering issued invoices.
  companyInfo: {
    businessName:  { type: String, required: true },
    vatNumber:     { type: String, required: true },
    address:       { type: String, required: true },
    phone:         { type: String, default: '' },
    email:         { type: String, default: '' }
  },

  // ─── Customer (optional, free text) ────────────────────────────────────
  customerName:    { type: String, trim: true },
  customerContact: { type: String, trim: true },

  // ─── Items — Denormalized line-item snapshot ───────────────────────────
  items: [{
    name:         { type: String, required: true },
    quantity:     { type: Number, required: true, min: 1 },
    unitPrice:    { type: Number, required: true },
    vatType:      { type: String, enum: ['standard', 'reduced', 'margin'], required: true },
    // Controls VAT column display:
    //   'standard' → "23%"
    //   'reduced'  → "13.5%"
    //   'margin'   → "Margin Scheme" (no rate, no amount shown)
    vatRate:      { type: Number, default: 0 },
    // Actual rate: 0.23, 0.135, or 0 for margin
    vatAmount:    { type: Number, default: 0 },
    // VAT portion of lineTotal (0 for margin items)
    lineTotal:    { type: Number, required: true }
    // Full line total as printed on receipt.
    // For standard/reduced: VAT-inclusive selling price.
    // For margin: full selling price (VAT not itemised).
  }],

  // ─── Financial Summary ─────────────────────────────────────────────────
  // ALL values COPIED from Transaction. NEVER recomputed.
  subtotalExVat:   { type: Number, required: true },
  // Sum of ex-VAT amounts for all items
  standardVatTotal:{ type: Number, default: 0 },
  // VAT on 23% goods
  reducedVatTotal: { type: Number, default: 0 },
  // VAT on 13.5% services
  marginVatTotal:  { type: Number, default: 0 },
  // Margin VAT — stored for internal audit, NOT shown on customer PDF
  grossTotal:      { type: Number, required: true },
  // Equals Transaction.totalAmount

  hasMarginItems:  { type: Boolean, default: false },
  // Controls whether margin scheme footer text appears

  // ─── Payment ───────────────────────────────────────────────────────────
  paymentMethod:   { type: String, enum: ['cash', 'card', 'split'], required: true },
  cashAmount:      { type: Number, default: null },
  cardAmount:      { type: Number, default: null },
  changeGiven:     { type: Number, default: null },

  // ─── Operator ──────────────────────────────────────────────────────────
  operator:        { type: mongoose.Schema.Types.ObjectId, ref: 'InvUser', required: true },
  operatorName:    { type: String },
  // Denormalized display name for PDF

  // ─── Audit ─────────────────────────────────────────────────────────────
  auditRef:        { type: String },
  // Format: "TXN-<transaction._id>"

  // ─── Secure sharing ────────────────────────────────────────────────────
  shareToken:      { type: String, unique: true, sparse: true },
  // Random token for secure sharing link (generated on demand)
  shareTokenExpiresAt: { type: Date },
  // Optional expiry for sharing link

  // ─── Delivery ──────────────────────────────────────────────────────────
  pdfPath:         { type: String },
  emailStatus:     { type: String, enum: ['not_sent', 'sent', 'failed'], default: 'not_sent' },
  emailSentAt:     { type: Date },

  // ─── Immutability ──────────────────────────────────────────────────────
  generatedAt:     { type: Date, default: Date.now, immutable: true }
});

// ─── Indexes ──────────────────────────────────────────────────────────────
// invoiceNumber has unique:true in schema (auto-indexed)
// transaction has index:true in schema (auto-indexed)
// Only add explicit indexes for fields not declared in schema
InvoiceSchema.index({ createdAt: -1 });

// ─── Immutability guard ──────────────────────────────────────────────────
// After creation, only delivery and sharing fields may change.
InvoiceSchema.pre('save', function () {
  if (this.isNew) return;

  // Allow updates to delivery/sharing fields only
  const mutable = ['pdfPath', 'emailStatus', 'emailSentAt', 'shareToken', 'shareTokenExpiresAt'];
  const modified = this.modifiedPaths();

  const immutableChanged = modified.some(function (p) {
    return !mutable.some(function (m) {
      return p === m || p.startsWith(m + '.');
    });
  });

  if (immutableChanged) {
    throw new Error('INVOICE_IMMUTABLE: Invoice financial data cannot be modified after creation.');
  }
});

// ─── Immutability guard for findOneAndUpdate ──────────────────────────
InvoiceSchema.pre('findOneAndUpdate', function () {
  const update = this.getUpdate() || {};
  const mutable = ['pdfPath', 'emailStatus', 'emailSentAt', 'shareToken', 'shareTokenExpiresAt'];
  const updates = update.$set || update;
  const immutableChanged = Object.keys(updates).some(function (p) {
    return !mutable.some(function (m) {
      return p === m || p.startsWith(m + '.');
    });
  });
  if (immutableChanged) {
    throw new Error('INVOICE_IMMUTABLE: Invoice financial data cannot be modified after creation.');
  }
});

// ─── Immutability guard for deletes ──────────────────────────────────
InvoiceSchema.pre('deleteOne', function () {
  throw new Error('INVOICE_IMMUTABLE: Invoice cannot be deleted.');
});
InvoiceSchema.pre('deleteMany', function () {
  throw new Error('INVOICE_IMMUTABLE: Invoice cannot be deleted.');
});

module.exports = mongoose.model('Invoice', InvoiceSchema);
