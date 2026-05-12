const mongoose = require('mongoose');

const ProductSchema = new mongoose.Schema({
  name:         { type: String, required: true, trim: true },
  sku:          { type: String, required: true, unique: true, trim: true },
  category:     { type: String, required: true, trim: true },
  costPrice:    { type: Number, min: 0, default: 0 },
  sellingPrice: { type: Number, required: true, min: 0 },
  vatRate:      { type: Number, default: 0.23, min: 0, max: 1 },
  stock:        { type: Number, default: 0, min: 0 },
  isSecondHand: { type: Boolean, default: false },
  purchasedFromCustomer: { type: Boolean, default: false },
  source:       { type: String, enum: ['customer', 'dealer', 'other', ''], default: '' },
  marginScheme: { type: Boolean, default: false },
  serialNumber: { type: String, trim: true },
  attributes:   { type: mongoose.Schema.Types.Mixed, default: {} },
  active:       { type: Boolean, default: true },
  deadStock:    { type: Boolean, default: false },
  lowStockThreshold: { type: Number, default: 10 },
  createdAt:    { type: Date, default: Date.now },
  updatedAt:    { type: Date, default: Date.now }
});

ProductSchema.index({ name: 'text', sku: 'text', serialNumber: 'text' });
ProductSchema.index({ category: 1, active: 1 });

module.exports = mongoose.model('Product', ProductSchema);
