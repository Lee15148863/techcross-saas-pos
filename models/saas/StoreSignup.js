const mongoose = require('mongoose');

const StoreSignupSchema = new mongoose.Schema({
  storeName:    { type: String, required: true, trim: true },
  ownerName:    { type: String, required: true, trim: true },
  email:        { type: String, required: true, trim: true, lowercase: true },
  phone:        { type: String, trim: true },
  country:      { type: String, trim: true },
  businessType: { type: String, trim: true },
  notes:        { type: String, trim: true },
  status:       { type: String, enum: ['pending', 'approved', 'rejected'], default: 'pending' },
  reviewedBy:   { type: mongoose.Schema.Types.ObjectId, ref: 'SaaSUser', default: null },
  reviewedAt:   { type: Date },
  createdAt:    { type: Date, default: Date.now }
});

// Prevent duplicate pending signups per email
StoreSignupSchema.index({ email: 1, status: 1 }, { partialFilterExpression: { status: 'pending' }, unique: true });

module.exports = mongoose.model('StoreSignup', StoreSignupSchema);
