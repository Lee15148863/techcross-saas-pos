const mongoose = require('mongoose');

const StoreSchema = new mongoose.Schema({
  name:         { type: String, required: true, trim: true },
  ownerName:    { type: String, required: true, trim: true },
  email:        { type: String, required: true, trim: true, lowercase: true },
  phone:        { type: String, trim: true },
  country:      { type: String, trim: true },
  businessType: { type: String, trim: true },
  notes:        { type: String, trim: true },
  status:       { type: String, enum: ['pending', 'active', 'suspended'], default: 'pending' },
  approvedBy:   { type: mongoose.Schema.Types.ObjectId, ref: 'SaaSUser', default: null },
  approvedAt:   { type: Date },
  createdAt:    { type: Date, default: Date.now },
  updatedAt:    { type: Date, default: Date.now },

  // Store-level settings (editable by store owner)
  logo:         { type: String, default: '' },       // base64 data URI or URL
  address:      { type: String, default: '' },
  vatNumber:    { type: String, default: '' },
  receiptTC:    { type: String, default: '' }        // text-only terms & conditions
});

StoreSchema.index({ email: 1 });
StoreSchema.index({ status: 1 });

module.exports = mongoose.model('SaaStore', StoreSchema);
