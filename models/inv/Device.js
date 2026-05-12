const mongoose = require('mongoose');
const { isAuthorized, SOURCES } = require('../../utils/inv-integrity-layer');

const STATUS_FLOW = ['BUY_IN', 'PENDING', 'TESTED', 'SOLD'];

const DeviceSchema = new mongoose.Schema({
  serialNumber: { type: String, required: true, unique: true, trim: true },
  status: {
    type: String,
    enum: STATUS_FLOW,
    default: 'BUY_IN',
    required: true,
  },
  buyPrice: { type: Number, required: true, min: 0 },
  source: { type: String, enum: ['customer', 'dealer', 'other'], default: 'customer' },
  product: { type: mongoose.Schema.Types.ObjectId, ref: 'Product' },
  sellPrice: { type: Number, min: 0 },
  sellTransaction: { type: mongoose.Schema.Types.ObjectId, ref: 'Transaction' },
  model: { type: String, trim: true },
  notes: { type: String, trim: true },
  createdAt: { type: Date, default: Date.now },
  updatedAt: { type: Date, default: Date.now },
});

DeviceSchema.index({ status: 1 });
DeviceSchema.index({ product: 1 });

// Prevent backward status transitions and protect financial fields
// (Mongoose 9: async pre-hooks use no `next`)
DeviceSchema.pre('save', async function () {
  this.updatedAt = new Date();

  // ── Financial field protection ──────────────────────────────────
  const modified = this.modifiedPaths();
  const hasSellFields = modified.includes('sellPrice') || modified.includes('sellTransaction');

  if (hasSellFields) {
    const isClearing = modified.includes('sellPrice') && this.sellPrice == null
                       && modified.includes('sellTransaction') && this.sellTransaction == null;
    if (isClearing) {
      if (!isAuthorized(this, SOURCES.REFUND)) {
        throw new Error('INTEGRITY: sellPrice/sellTransaction can only be cleared by refund service');
      }
    } else if (!isAuthorized(this, SOURCES.CHECKOUT)) {
      throw new Error('INTEGRITY: sellPrice/sellTransaction can only be set by checkout service');
    }
  }

  if (!this.isNew && modified.includes('buyPrice')) {
    if (!isAuthorized(this, SOURCES.ROOT_EDIT)) {
      throw new Error('INTEGRITY: buyPrice can only be changed by root');
    }
  }

  // ── Backward status transition prevention ───────────────────────
  if (this.isNew || !this.isModified('status')) return;

  const current = await mongoose.model('Device').findById(this._id).select('status').lean();
  if (current && STATUS_FLOW.indexOf(current.status) > STATUS_FLOW.indexOf(this.status)) {
    if (!isAuthorized(this, SOURCES.REFUND)) {
      throw new Error(`Device status cannot go backward: ${current.status} → ${this.status}`);
    }
  }
});

// Block direct financial field updates via query-based operations
DeviceSchema.pre('findOneAndUpdate', function () {
  const update = this.getUpdate() || {};
  const set = update.$set || {};
  const unset = update.$unset || {};
  if (set.sellPrice != null || set.sellTransaction != null || update.sellPrice != null
      || unset.sellPrice != null || unset.sellTransaction != null) {
    throw new Error('INTEGRITY: Device financial fields cannot be updated via direct query');
  }
  if (set.buyPrice != null || update.buyPrice != null) {
    throw new Error('INTEGRITY: Device buyPrice can only be updated via root service');
  }
});

module.exports = { Device: mongoose.model('Device', DeviceSchema), STATUS_FLOW };
