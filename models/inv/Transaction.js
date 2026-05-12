const mongoose = require('mongoose');
const {
  isAuthorized, SOURCES, getSource,
  validateTransactionVAT, validateTransactionPayment,
} = require('../../utils/inv-integrity-layer');

const TransactionSchema = new mongoose.Schema({
  receiptNumber: { type: String, required: true, unique: true }, // YYYYMMDDHHmmss
  items: [{
    product:      { type: mongoose.Schema.Types.ObjectId, ref: 'Product' },
    name:         { type: String, required: true },
    sku:          { type: String, default: '' },
    serialNumber: { type: String },
    quantity:     { type: Number, required: true, min: 1 },
    unitPrice:    { type: Number, required: true },
    costPrice:    { type: Number, default: 0 },
    isSecondHand: { type: Boolean, default: false },
    purchasedFromCustomer: { type: Boolean, default: false },
    marginScheme: { type: Boolean, default: false },
    source:       { type: String, enum: ['customer', 'dealer', 'other', ''], default: '' },
    vatRate:      { type: Number, default: 0.23 },
    discount:     {
      type:  { type: String, enum: ['percentage', 'fixed'] },
      value: { type: Number }
    },
    discountedPrice: { type: Number },
    subtotal:     { type: Number, required: true },
    vatAmount:    { type: Number, default: 0 },
    marginVat:    { type: Number, default: 0 }
  }],
  orderDiscount: {
    type:  { type: String, enum: ['percentage', 'fixed'] },
    value: { type: Number }
  },
  subtotalBeforeOrderDiscount: { type: Number },
  totalAmount:      { type: Number, required: true },
  standardVatTotal: { type: Number, default: 0 },
  marginVatTotal:   { type: Number, default: 0 },
  paymentMethod:    { type: String, enum: ['cash', 'card', 'split'], required: true },
  cardAmount:       { type: Number },
  cashReceived:     { type: Number },
  changeGiven:      { type: Number },
  operator:         { type: mongoose.Schema.Types.ObjectId, ref: 'InvUser', required: true },
  discountOperator: { type: mongoose.Schema.Types.ObjectId, ref: 'InvUser' },
  originalReceipt:  { type: String, default: null },
  invoiceGenerated: { type: Boolean, default: false },
  exported:         { type: Boolean, default: false },
  createdAt:        { type: Date, default: Date.now }
});

TransactionSchema.index({ createdAt: -1 });
TransactionSchema.index({ 'items.serialNumber': 1 });
TransactionSchema.index(
  { originalReceipt: 1 },
  { unique: true, partialFilterExpression: { originalReceipt: { $type: 'string' } } }
);

// ─── Integrity Layer ──────────────────────────────────────────────────
// Block direct Transaction creation outside approved services.
// Re-validate VAT calculations and payment consistency before persist.
TransactionSchema.pre('save', function () {
  if (this.isNew) {
    if (!isAuthorized(this, SOURCES.CHECKOUT, SOURCES.REFUND)) {
      throw new Error(
        'INTEGRITY: Direct Transaction creation is not permitted. ' +
        'Use checkout or refund service.'
      );
    }
    validateTransactionVAT(this, getSource(this));
    validateTransactionPayment(this);
  }
  // Existing documents (root edits) are allowed to proceed
});

module.exports = mongoose.model('Transaction', TransactionSchema);
