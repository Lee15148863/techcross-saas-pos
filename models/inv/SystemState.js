/**
 * System State — Global Safety Switch
 *
 * Singleton document holding the current system-wide operational state.
 * Used by requireSystemActive() to block financial operations during
 * emergencies or maintenance.
 *
 * Status values:
 *   ACTIVE — Normal operations (default)
 *   PAUSED — Soft pause, POS blocked, read-only queries allowed
 *   LOCKED — Full lock, all financial operations blocked until unlock
 *
 * Only one document ever exists (singleton pattern via upsert on _id).
 */

const mongoose = require('mongoose');

const SystemStateSchema = new mongoose.Schema({
  _id:        { type: String, default: 'global' }, // singleton key
  status:     { type: String, enum: ['ACTIVE', 'PAUSED', 'LOCKED'], default: 'ACTIVE', required: true },
  reason:     { type: String, default: '' },
  triggeredBy: { type: mongoose.Schema.Types.ObjectId, ref: 'InvUser', default: null },
  timestamp:  { type: Date, default: Date.now },
});

SystemStateSchema.statics.ensureExists = async function () {
  const existing = await this.findById('global');
  if (!existing) {
    return this.create({ _id: 'global', status: 'ACTIVE', reason: '', timestamp: new Date() });
  }
  return existing;
};

module.exports = mongoose.model('SystemState', SystemStateSchema);
