const mongoose = require('mongoose');
const { isAuthorized, SOURCES } = require('../../utils/inv-integrity-layer');

const CashLedgerSchema = new mongoose.Schema({
  entryType: {
    type: String,
    enum: ['sale', 'refund', 'supplier', 'expense', 'device_buy', 'bank_in', 'bank_out'],
    required: true,
  },
  direction: {
    type: String,
    enum: ['in', 'out'],
    required: true,
  },
  amount: { type: Number, required: true },
  paymentMethod: {
    type: String,
    enum: ['cash', 'card', 'split'],
    required: true,
  },
  cashReceived: { type: Number, default: null },
  changeGiven: { type: Number, default: null },
  cardAmount: { type: Number, default: null },
  referenceType: {
    type: String,
    enum: ['transaction', 'purchase', 'expense', 'device'],
    required: true,
  },
  referenceId: { type: mongoose.Schema.Types.ObjectId, required: true },
  receiptNumber: { type: String },
  description: { type: String, default: '' },
  operator: { type: mongoose.Schema.Types.ObjectId, ref: 'InvUser', required: true },
  createdAt: { type: Date, default: Date.now },
});

CashLedgerSchema.index({ createdAt: -1 });
CashLedgerSchema.index({ entryType: 1, createdAt: -1 });
CashLedgerSchema.index({ referenceType: 1, referenceId: 1 });

// Immutable guard: reject any write on existing documents (Mongoose 9: no `next`)
// Also require authorization for new entries — no direct CashLedger creation
CashLedgerSchema.pre('save', function () {
  if (!this.isNew) {
    throw new Error('Cash ledger entries are immutable and cannot be modified');
  }
  if (!isAuthorized(this, SOURCES.CHECKOUT, SOURCES.REFUND, SOURCES.ROOT_EDIT)) {
    throw new Error(
      'INTEGRITY: Direct CashLedger creation is not permitted. ' +
      'Use checkout, refund, or root service.'
    );
  }
});
CashLedgerSchema.pre('findOneAndUpdate', function () {
  throw new Error('Cash ledger entries are immutable');
});
CashLedgerSchema.pre('findOneAndDelete', function () {
  throw new Error('Cash ledger entries cannot be deleted');
});
CashLedgerSchema.pre('findOneAndReplace', function () {
  throw new Error('Cash ledger entries are immutable');
});
CashLedgerSchema.pre('updateOne', function () {
  throw new Error('Cash ledger entries are immutable');
});
CashLedgerSchema.pre('updateMany', function () {
  throw new Error('Cash ledger entries are immutable');
});
CashLedgerSchema.pre('deleteOne', function () {
  throw new Error('Cash ledger entries cannot be deleted');
});
CashLedgerSchema.pre('deleteMany', function () {
  throw new Error('Cash ledger entries cannot be deleted');
});

module.exports = mongoose.model('CashLedger', CashLedgerSchema);
