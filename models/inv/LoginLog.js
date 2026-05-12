const mongoose = require('mongoose');

const LoginLogSchema = new mongoose.Schema({
  user:      { type: mongoose.Schema.Types.ObjectId, ref: 'InvUser', required: true },
  username:  { type: String, required: true },
  success:   { type: Boolean, required: true },
  ip:        { type: String },
  userAgent: { type: String },
  createdAt: { type: Date, default: Date.now }
});

LoginLogSchema.index({ createdAt: -1 });
LoginLogSchema.index({ user: 1, createdAt: -1 });

// ─── Immutability: LoginLog is append-only ──────────────────────────────
LoginLogSchema.pre('save', function () {
  if (!this.isNew) {
    throw new Error('LOGINLOG_IMMUTABLE: Login log entries cannot be modified.');
  }
});
LoginLogSchema.pre('findOneAndUpdate', function () {
  throw new Error('LOGINLOG_IMMUTABLE: Login log entries cannot be updated.');
});
LoginLogSchema.pre('updateOne', function () {
  throw new Error('LOGINLOG_IMMUTABLE: Login log entries cannot be updated.');
});
LoginLogSchema.pre('updateMany', function () {
  throw new Error('LOGINLOG_IMMUTABLE: Login log entries cannot be updated.');
});
LoginLogSchema.pre('deleteOne', function () {
  throw new Error('LOGINLOG_IMMUTABLE: Login log entries cannot be deleted.');
});
LoginLogSchema.pre('deleteMany', function () {
  throw new Error('LOGINLOG_IMMUTABLE: Login log entries cannot be deleted.');
});
LoginLogSchema.pre('findOneAndDelete', function () {
  throw new Error('LOGINLOG_IMMUTABLE: Login log entries cannot be deleted.');
});

module.exports = mongoose.model('LoginLog', LoginLogSchema);
