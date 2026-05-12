const mongoose = require('mongoose');

const auditSchema = new mongoose.Schema({
  deploymentId: { type: mongoose.Schema.Types.ObjectId, ref: 'SaaSDeployment', required: true },
  storeName:    { type: String, default: '' },
  serviceName:  { type: String, default: '' },

  action:   { type: String, required: true },
  result:   { type: String, enum: ['success', 'failed'], default: 'success' },
  reason:   { type: String, default: '' },
  details:  { type: mongoose.Schema.Types.Mixed, default: {} },

  adminUser:   { type: mongoose.Schema.Types.ObjectId, ref: 'SaaSUser' },
  adminName:   { type: String, default: '' },

  // Snapshot of deployment state at time of action
  snapshot: {
    status:   String,
    version:  String,
    imageTag: String
  }
}, {
  timestamps: true
});

auditSchema.index({ deploymentId: 1, createdAt: -1 });
auditSchema.index({ action: 1 });
auditSchema.index({ createdAt: -1 });

module.exports = mongoose.model('SaaSDeploymentAudit', auditSchema);
