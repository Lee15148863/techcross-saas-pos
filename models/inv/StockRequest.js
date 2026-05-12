const mongoose = require('mongoose');

const StockRequestSchema = new mongoose.Schema({
  product:    { type: mongoose.Schema.Types.ObjectId, ref: 'Product', required: true },
  type:       { type: String, enum: ['entry', 'exit'], required: true },
  quantity:   { type: Number, required: true, min: 1 },
  note:       { type: String, trim: true },
  status:     { type: String, enum: ['pending', 'approved', 'rejected'], default: 'pending' },
  requestedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'InvUser', required: true },
  reviewedBy:  { type: mongoose.Schema.Types.ObjectId, ref: 'InvUser' },
  reviewNote:  { type: String, trim: true },
  reviewedAt:  { type: Date },
  createdAt:   { type: Date, default: Date.now }
});

StockRequestSchema.index({ status: 1, createdAt: -1 });

module.exports = mongoose.model('StockRequest', StockRequestSchema);
