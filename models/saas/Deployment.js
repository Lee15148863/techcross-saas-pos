const mongoose = require('mongoose');

// ─── Version subdocument ────────────────────────────────────────────────
// Each entry records one deployment event with immutable provenance data.
const versionEntrySchema = new mongoose.Schema({
  version:      { type: String, required: true },
  imageTag:     { type: String, required: true },
  gitCommit:    { type: String, default: '' },
  releaseNotes: { type: String, default: '' },
  buildId:      { type: String, default: '' },
  deployedAt:   { type: Date, default: Date.now },
  deployedBy:   { type: mongoose.Schema.Types.ObjectId, ref: 'SaaSUser' },
  status:       { type: String, enum: ['success', 'failed'], default: 'success' },
  // Cloud Run revision tracking
  revisionName: { type: String, default: '' },
  dockerImage:  { type: String, default: '' }
}, { _id: true });

// ─── Top-level schema ───────────────────────────────────────────────────
const deploymentSchema = new mongoose.Schema({
  storeName:   { type: String, required: true, trim: true },
  subdomain:   { type: String, required: true, trim: true },
  serviceName: { type: String, required: true, trim: true },
  mongoUri:    { type: String, required: true },

  status: {
    type: String,
    enum: ['pending', 'deploying', 'running', 'suspended', 'readonly_frozen', 'failed'],
    default: 'pending'
  },

  cloudRunUrl: { type: String, default: '' },
  imageTag:    { type: String, default: '' },
  version:     { type: String, default: '1.0.0' },
  buildId:     { type: String, default: '' },
  gitCommit:   { type: String, default: '' },

  deployedAt:    Date,
  deployedBy:    { type: mongoose.Schema.Types.ObjectId, ref: 'SaaSUser' },
  lastRestartAt: Date,
  error:         { type: String, default: '' },

  env:      { type: Map, of: String, default: {} },
  versions: [versionEntrySchema],

  // Store timezone for dynamic code verification
  timezone: { type: String, default: 'Europe/Dublin' },

  // ── Subscription lifecycle ────────────────────────────────────────────────
  subscriptionStart:       { type: Date, default: Date.now },
  subscriptionExpiresAt:   { type: Date, default: function() { return new Date(Date.now() + 30 * 24 * 60 * 60 * 1000); } },
  subscriptionStatus:      { type: String, enum: ['trial', 'active', 'expired', 'readonly_frozen', 'suspended', 'deleted'], default: 'trial' },
  gracePeriodDays:         { type: Number, default: 7, min: 0, max: 365 },

  // Security: deployment PIN hash (bcrypt). Never stores plaintext.
  pinHash:  { type: String, default: '' },
  pinSetAt: Date,

  // Health monitoring
  lastHealthCheck:          { type: Date },
  lastSuccessfulHealthCheck:{ type: Date },
  lastHealthStatus:         { type: String, enum: ['healthy', 'offline', 'unknown'], default: 'unknown' },
  lastMongoStatus:          { type: Number, default: -1 },
  healthLatency:            { type: Number, default: -1 },
  lastHealthError:          { type: String, default: '' }
}, {
  timestamps: true
});

// ─── Indexes ────────────────────────────────────────────────────────────
deploymentSchema.index({ serviceName: 1 });
deploymentSchema.index({ status: 1 });
deploymentSchema.index({ 'versions.deployedAt': -1 });

module.exports = mongoose.model('SaaSDeployment', deploymentSchema);
