const mongoose = require('mongoose');

const SAAS_ROLES = ['super_admin', 'store_root', 'manager', 'staff'];

const SaaSUserSchema = new mongoose.Schema({
  username:      { type: String, required: true, unique: true, trim: true },
  password:      { type: String, required: true },
  displayName:   { type: String, required: true, trim: true },
  email:         { type: String, required: true, trim: true, lowercase: true },
  role:          { type: String, enum: SAAS_ROLES, required: true },
  storeId:       { type: mongoose.Schema.Types.ObjectId, ref: 'SaaStore', default: null },
  active:        { type: Boolean, default: true },
  loginAttempts: { type: Number, default: 0 },
  lockUntil:     { type: Date, default: null },
  createdAt:     { type: Date, default: Date.now },
  updatedAt:     { type: Date, default: Date.now }
});

SaaSUserSchema.index({ email: 1 });
SaaSUserSchema.index({ storeId: 1 });

module.exports = mongoose.model('SaaSUser', SaaSUserSchema);
module.exports.SAAS_ROLES = SAAS_ROLES;
