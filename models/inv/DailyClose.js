const mongoose = require('mongoose');

/**
 * Daily Close Snapshot
 *
 * SYSTEM_SPEC §10 — DAILY CLOSE: OPEN → PENDING → CLOSED
 * SYSTEM_SPEC §11 — DAILY SNAPSHOT: must include total sales, VAT output,
 *                   VAT input, cash, card. MUST be immutable.
 *
 * Once status becomes 'closed', all mutations are blocked at the model layer.
 */

const DailyCloseSchema = new mongoose.Schema({
  date: { type: String, required: true, unique: true, trim: true }, // YYYY-MM-DD
  status: { type: String, enum: ['open', 'pending', 'closed'], default: 'open' },
  closedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'InvUser' },
  closedAt: { type: Date },

  // ── Summary ────────────────────────────────────────────────────
  transactionCount: { type: Number, default: 0 },
  grossSales: { type: Number, default: 0 },
  refundTotal: { type: Number, default: 0 },
  refundCount: { type: Number, default: 0 },
  netSales: { type: Number, default: 0 },

  // ── Payment breakdown ──────────────────────────────────────────
  cashTotal: { type: Number, default: 0 },
  cardTotal: { type: Number, default: 0 },
  splitCardTotal: { type: Number, default: 0 },
  splitCashTotal: { type: Number, default: 0 },

  // ── VAT (all from stored values, never recalculated) ───────────
  standard23Sales: { type: Number, default: 0 },
  standard23Vat: { type: Number, default: 0 },
  reduced135Sales: { type: Number, default: 0 },
  reduced135Vat: { type: Number, default: 0 },
  marginSales: { type: Number, default: 0 },
  marginVat: { type: Number, default: 0 },
  totalVat: { type: Number, default: 0 },
  marginItems: [{
    receiptNumber: String,
    name: String,
    sku: String,
    costPrice: Number,
    sellingPrice: Number,
    discountedPrice: Number,
    margin: Number,
    vatPayable: Number,
    quantity: Number,
    marginScheme: Boolean,
  }],

  // ── Device P&L (from Device model, §2.4) ───────────────────────
  deviceProfitLoss: {
    totalBuyPrice: { type: Number, default: 0 },
    totalSellPrice: { type: Number, default: 0 },
    grossProfit: { type: Number, default: 0 },
    count: { type: Number, default: 0 },
    soldCount: { type: Number, default: 0 },
  },

  // ── Expenses ───────────────────────────────────────────────────
  expenseTotal: { type: Number, default: 0 },
  expenseCash: { type: Number, default: 0 },
  expenseCard: { type: Number, default: 0 },
  netCash: { type: Number, default: 0 },

  // ── Validation results ─────────────────────────────────────────
  validation: {
    transactionLedgerMatch: { type: Boolean, default: false },
    transactionTotal: { type: Number, default: 0 },
    ledgerTotal: { type: Number, default: 0 },
    cashReconciliation: { type: Boolean, default: false },
    cashFromTxns: { type: Number, default: 0 },
    cashFromLedger: { type: Number, default: 0 },
    difference: { type: Number, default: 0 },
  },
}, { timestamps: true });

DailyCloseSchema.index({ status: 1 });

// ─── Immutability guard ────────────────────────────────────────────
// Once status='closed', the document cannot be modified.
// New documents are always allowed (status='open').
// Closing flow sets status='closed' atomically on first close.
DailyCloseSchema.pre('save', async function () {
  if (!this.isNew && this.status === 'closed') {
    const existing = await mongoose.model('DailyClose').findById(this._id).select('status').lean();
    if (existing && existing.status === 'closed') {
      throw new Error('Daily close snapshot is immutable after closing');
    }
  }
});

DailyCloseSchema.pre('findOneAndUpdate', function () {
  throw new Error('Daily close entries cannot be updated via direct query');
});

DailyCloseSchema.pre('findOneAndDelete', function () {
  throw new Error('Daily close entries cannot be deleted');
});

DailyCloseSchema.pre('deleteOne', function () {
  throw new Error('Daily close entries cannot be deleted');
});

module.exports = mongoose.model('DailyClose', DailyCloseSchema);
