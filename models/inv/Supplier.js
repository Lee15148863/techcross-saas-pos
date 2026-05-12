const mongoose = require('mongoose');

const SupplierSchema = new mongoose.Schema({
  name:          { type: String, required: true, trim: true },
  contactName:   { type: String, trim: true },
  phone:         { type: String, trim: true },
  email:         { type: String, trim: true },
  address:       { type: String, trim: true },
  level:         { type: String, enum: ['core', 'normal', 'temporary'], default: 'normal' },
  active:        { type: Boolean, default: true },
  disableReason: { type: String, trim: true },
  disabledAt:    { type: Date },
  note:          { type: String, trim: true },
  createdAt:     { type: Date, default: Date.now },
  updatedAt:     { type: Date, default: Date.now }
});

module.exports = mongoose.model('Supplier', SupplierSchema);
