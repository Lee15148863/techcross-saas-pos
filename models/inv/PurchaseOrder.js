const mongoose = require('mongoose');

const PurchaseOrderSchema = new mongoose.Schema({
  orderNumber:     { type: String, required: true, unique: true },
  supplier:        { type: mongoose.Schema.Types.ObjectId, ref: 'Supplier', required: true },
  items: [{
    product:   { type: mongoose.Schema.Types.ObjectId, ref: 'Product', required: true },
    quantity:  { type: Number, required: true, min: 1 },
    unitPrice: { type: Number, required: true, min: 0 }
  }],
  totalAmount:     { type: Number, required: true },
  status:          { type: String, enum: ['pending', 'received', 'cancelled'], default: 'pending' },
  purchaseDate:    { type: Date, default: Date.now },
  expectedArrival: { type: Date },
  receivedAt:      { type: Date },
  operator:        { type: mongoose.Schema.Types.ObjectId, ref: 'InvUser', required: true },
  note:            { type: String, trim: true },
  createdAt:       { type: Date, default: Date.now },
  updatedAt:       { type: Date, default: Date.now }
});

PurchaseOrderSchema.index({ status: 1, purchaseDate: -1 });

module.exports = mongoose.model('PurchaseOrder', PurchaseOrderSchema);
