const mongoose = require('mongoose');

const TrustedDeviceSchema = new mongoose.Schema({
  userId:       { type: mongoose.Schema.Types.ObjectId, ref: 'InvUser', required: true },
  deviceId:     { type: String, required: true },
  deviceName:   { type: String, default: '' },
  trusted:      { type: Boolean, default: true },
  firstSeenAt:  { type: Date, default: Date.now },
  lastUsedAt:   { type: Date, default: Date.now },
  trustLevel:   { type: String, enum: ['trusted', 'untrusted'], default: 'untrusted' },
  revoked:      { type: Boolean, default: false },
  failedAttempts: { type: Number, default: 0 },
  failedAt:     { type: Date },
  ipHash:       { type: String }
});

TrustedDeviceSchema.index({ userId: 1, deviceId: 1 }, { unique: true });
TrustedDeviceSchema.index({ deviceId: 1 });

module.exports = mongoose.model('TrustedDevice', TrustedDeviceSchema);
