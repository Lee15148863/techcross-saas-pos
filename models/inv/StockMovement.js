const mongoose = require('mongoose');

const StockMovementSchema = new mongoose.Schema({
  product:       { type: mongoose.Schema.Types.ObjectId, ref: 'Product', required: true },
  type:          { type: String, enum: ['entry', 'exit'], required: true },
  quantity:      { type: Number, required: true, min: 1 },
  operator:      { type: mongoose.Schema.Types.ObjectId, ref: 'InvUser', required: true },
  reason:        { type: String, trim: true },
  referenceId:   { type: String, trim: true },
  referenceType: { type: String, enum: ['purchase', 'transaction', 'manual', 'reconcile', 'refund'] },
  serialNumber:  { type: String, trim: true },
  note:          { type: String, trim: true },
  createdAt:     { type: Date, default: Date.now }
});

StockMovementSchema.index({ product: 1, createdAt: -1 });
StockMovementSchema.index({ referenceId: 1 });

module.exports = mongoose.model('StockMovement', StockMovementSchema);
