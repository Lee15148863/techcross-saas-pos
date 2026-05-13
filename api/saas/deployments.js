const express = require('express');
const router = express.Router();
const bcrypt = require('bcryptjs');
const rateLimit = require('express-rate-limit');
const { defaultKeyGenerator } = rateLimit;
const Deployment = require('../../models/saas/Deployment');
const DeploymentAudit = require('../../models/saas/DeploymentAudit');
const { getLocalHHMM, getLocalHHMMRange, isTimezoneSupported, SUPPORTED_TIMEZONES, verifyActionCode, recordAudit } = require('../../utils/deployment-security');

// ─── Rate limiters ─────────────────────────────────────────────────────────

const keyGen = defaultKeyGenerator;

var deployLimiter = rateLimit({
  windowMs: 60 * 60 * 1000, // 1 hour
  max: 5,
  keyGenerator: keyGen,
  message: { error: 'Too many deploy requests. Limit: 5/hour.' },
  standardHeaders: true, legacyHeaders: false,
  validate: { xForwardedForHeader: false }
});

var rollbackLimiter = rateLimit({
  windowMs: 60 * 60 * 1000, max: 5,
  keyGenerator: keyGen,
  message: { error: 'Too many rollback requests. Limit: 5/hour.' },
  standardHeaders: true, legacyHeaders: false,
  validate: { xForwardedForHeader: false }
});

var suspendLimiter = rateLimit({
  windowMs: 60 * 60 * 1000, max: 10,
  keyGenerator: keyGen,
  message: { error: 'Too many suspend requests. Limit: 10/hour.' },
  standardHeaders: true, legacyHeaders: false,
  validate: { xForwardedForHeader: false }
});

var activateLimiter = rateLimit({
  windowMs: 60 * 60 * 1000, max: 10,
  keyGenerator: keyGen,
  message: { error: 'Too many activate requests. Limit: 10/hour.' },
  standardHeaders: true, legacyHeaders: false,
  validate: { xForwardedForHeader: false }
});

var dangerousActionLimiter = rateLimit({
  windowMs: 60 * 60 * 1000, max: 20,
  keyGenerator: keyGen,
  message: { error: 'Too many dangerous action attempts. Limit: 20/hour.' },
  standardHeaders: true, legacyHeaders: false,
  validate: { xForwardedForHeader: false }
});

var healthLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 minute
  max: 60,
  keyGenerator: keyGen,
  message: { error: 'Too many health check requests. Limit: 60/minute.' },
  standardHeaders: true, legacyHeaders: false,
  validate: { xForwardedForHeader: false }
});

// Active polling tracker — prevents duplicate polling loops per deployment
var activePolls = {};

// GCP admin utils — loaded lazily so a missing google-auth-library doesn't crash non-deploy routes
let gcpAdmin = null;
function getGcpAdmin() {
  if (!gcpAdmin) {
    try { gcpAdmin = require('../../utils/gcp-admin'); }
    catch (e) { gcpAdmin = null; }
  }
  return gcpAdmin;
}

// ─── Super admin auth middleware ──────────────────────────────────────────────

function superAdminAuth(req, res, next) {
  const jwt = require('jsonwebtoken');
  const secret = process.env.SAAS_JWT_SECRET;
  if (!secret) return res.status(500).json({ error: 'SAAS_JWT_SECRET not configured' });

  const authHeader = req.headers['authorization'];
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  try {
    const decoded = jwt.verify(authHeader.slice(7), secret);
    if (decoded.role !== 'super_admin') {
      return res.status(403).json({ error: 'Super admin only' });
    }
    req.user = decoded;
    next();
  } catch (e) {
    return res.status(401).json({ error: 'Invalid token' });
  }
}

// ─── CRUD routes ──────────────────────────────────────────────────────────────

// GET /api/saas/deployments — list all deployments
router.get('/', superAdminAuth, async (req, res) => {
  try {
    const deployments = await Deployment.find({}).sort({ createdAt: -1 });
    res.json(deployments);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// GET /api/saas/deployments/:id — single deployment
router.get('/:id', superAdminAuth, async (req, res) => {
  try {
    const dep = await Deployment.findById(req.params.id);
    if (!dep) return res.status(404).json({ error: 'Deployment not found' });
    res.json(dep);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// POST /api/saas/deployments — create a new deployment record
router.post('/', superAdminAuth, async (req, res) => {
  try {
    const { storeName, subdomain, mongoUri, env, deployPin, timezone, subscriptionStatus, subscriptionExpiresAt } = req.body;
    if (!storeName || !subdomain || !mongoUri) {
      return res.status(400).json({ error: 'storeName, subdomain, and mongoUri required' });
    }

    // Validate subscription fields if provided
    var subStatus = undefined;
    if (subscriptionStatus) {
      var VALID_SUB_STATUSES = ['trial', 'active'];
      if (VALID_SUB_STATUSES.indexOf(subscriptionStatus) === -1) {
        return res.status(400).json({ error: 'subscriptionStatus on create must be trial or active' });
      }
      subStatus = subscriptionStatus;
    }
    if (subscriptionExpiresAt) {
      var expiryDate = new Date(subscriptionExpiresAt);
      if (isNaN(expiryDate.getTime())) {
        return res.status(400).json({ error: 'Invalid subscriptionExpiresAt date' });
      }
    }

    // Validate timezone if provided
    var storeTimezone = timezone || 'Europe/Dublin';
    if (timezone && !isTimezoneSupported(timezone)) {
      return res.status(400).json({ error: 'Unsupported timezone. Supported: ' + SUPPORTED_TIMEZONES.join(', ') });
    }

    // Sanitize service name
    var serviceName = subdomain.toLowerCase().replace(/[^a-z0-9-]/g, '-').replace(/--+/g, '-').replace(/^-|-$/g, '').slice(0, 63);
    if (!serviceName) {
      return res.status(400).json({ error: 'subdomain produced invalid service name' });
    }

    // Check for duplicate service name
    const existing = await Deployment.findOne({ serviceName });
    if (existing) {
      return res.status(409).json({ error: 'Service name "' + serviceName + '" already in use' });
    }

    // Hash deployment PIN (4-20 digit numeric)
    var pinHash = '';
    if (deployPin) {
      var pinStr = String(deployPin).replace(/\D/g, '');
      if (pinStr.length < 4 || pinStr.length > 20) {
        return res.status(400).json({ error: 'Deployment PIN must be 4-20 digits' });
      }
      pinHash = await bcrypt.hash(pinStr, 10);
    }

    var createFields = {
      storeName: storeName.trim(),
      subdomain: subdomain.trim().toLowerCase(),
      serviceName: serviceName,
      mongoUri: mongoUri,
      status: 'pending',
      deployedBy: req.user.userId,
      env: env || {},
      pinHash: pinHash,
      pinSetAt: pinHash ? new Date() : undefined,
      timezone: storeTimezone
    };
    if (subStatus) createFields.subscriptionStatus = subStatus;
    if (subscriptionExpiresAt) {
      createFields.subscriptionExpiresAt = new Date(subscriptionExpiresAt);
    }
    const dep = await Deployment.create(createFields);

    res.status(201).json(dep);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// DELETE /api/saas/deployments/:id — delete a deployment record (requires PIN)
router.delete('/:id', dangerousActionLimiter, superAdminAuth, async (req, res) => {
  try {
    const dep = await Deployment.findById(req.params.id);
    if (!dep) return res.status(404).json({ error: 'Deployment not found' });

    var reason = await verifyDangerousAction(req, res, dep, 'destroy');
    if (!reason) return;

    await Deployment.deleteOne({ _id: req.params.id });
    await recordAudit(dep._id, 'destroy', 'success', reason, req.user, { ip: req.ip });
    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ─── Helpers ────────────────────────────────────────────────────────────────

/**
 * Try to detect the current git commit SHA from the environment or local repo.
 */
function detectGitCommit() {
  // Precedence: explicit env var, Cloud Build substitution, local git
  if (process.env.COMMIT_SHA) return process.env.COMMIT_SHA;
  if (process.env.GIT_COMMIT) return process.env.GIT_COMMIT;
  try {
    return require('child_process').execSync('git rev-parse HEAD', { encoding: 'utf8', timeout: 3000 }).trim();
  } catch (e) {
    return '';
  }
}

/**
 * Check if a deployment's subscription is expired and auto-freeze if needed.
 * Returns { expired, alreadyFrozen } so callers can decide how to respond.
 */
async function enforceSubscriptionExpiry(dep) {
  if (!dep || !dep.subscriptionExpiresAt) return { expired: false, alreadyFrozen: false };
  if (dep.subscriptionStatus === 'deleted') return { expired: true, alreadyFrozen: true };
  if (['expired', 'readonly_frozen'].indexOf(dep.subscriptionStatus) !== -1) {
    return { expired: true, alreadyFrozen: dep.status === 'readonly_frozen' };
  }
  var graceEnd = new Date(dep.subscriptionExpiresAt.getTime() + (dep.gracePeriodDays || 7) * 24 * 60 * 60 * 1000);
  if (new Date() > graceEnd && ['trial', 'active'].indexOf(dep.subscriptionStatus) !== -1) {
    return { expired: true, alreadyFrozen: false };
  }
  return { expired: false, alreadyFrozen: false };
}

/**
 * Verify dangerous action code for a deployment.
 * Sends error response and returns null on failure.
 * Returns reason string on success.
 */
async function verifyDangerousAction(req, res, dep, actionName) {
  var code = req.body.actionCode;
  var reason = (req.body.reason || '').trim();
  if (!reason) {
    res.status(400).json({ error: 'Reason required for dangerous action' });
    return null;
  }
  var verification = await verifyActionCode(dep, code);
  if (!verification.valid) {
    await recordAudit(dep._id, actionName, 'failed', reason, req.user, { error: verification.error, ip: req.ip });
    res.status(403).json({ error: verification.error });
    return null;
  }
  return reason;
}

// ─── Action routes ────────────────────────────────────────────────────────────

// POST /api/saas/deployments/:id/deploy — trigger or re-deploy
// Requires actionCode + reason (PIN verification) if deployment is not in 'pending' state.
router.post('/:id/deploy', deployLimiter, superAdminAuth, async (req, res) => {
  try {
    const dep = await Deployment.findById(req.params.id);
    if (!dep) return res.status(404).json({ error: 'Deployment not found' });

    // ── Deploy lock: reject if already deploying (unless stuck >30 min) ──
    if (dep.status === 'deploying') {
      var thirtyMinAgo = new Date(Date.now() - 30 * 60 * 1000);
      if (dep.deployedAt && dep.deployedAt < thirtyMinAgo) {
        // Auto-recover stuck deployment
        dep.versions.push({
          version: dep.version || '0.0.0',
          imageTag: dep.imageTag || '',
          gitCommit: dep.gitCommit || '',
          releaseNotes: 'Auto-recovered from stuck deploying state (>30min)',
          buildId: '',
          deployedAt: new Date(),
          deployedBy: req.user ? req.user.userId : null,
          status: 'failed'
        });
        dep.status = 'failed';
        dep.error = 'Auto-recovered: stuck in deploying state >30 minutes';
        await dep.save();
        await recordAudit(dep._id, 'deploy', 'failed', 'Auto-recovery: stuck deploying', req.user, { error: dep.error, ip: req.ip });
        // Fall through to allow re-deploy
      } else {
        return res.status(409).json({ error: 'Deployment already in progress. Wait for current deploy to complete.' });
      }
    }

    // ── Subscription expiry check ────────────────────────────────────
    var subCheck = await enforceSubscriptionExpiry(dep);
    if (subCheck.expired) {
      return res.status(403).json({ error: 'Cannot deploy: subscription is ' + dep.subscriptionStatus + '. Extend subscription first.' });
    }

    // ── Re-deploys require dangerous action verification ──────────────
    var isRedeploy = dep.status !== 'pending';
    if (isRedeploy) {
      var reason = await verifyDangerousAction(req, res, dep, 'redeploy');
      if (!reason) return;
    }

    const gcp = getGcpAdmin();
    if (!gcp) {
      return res.status(501).json({ error: 'GCP admin utils not available (google-auth-library missing)' });
    }

    const projectId = process.env.GOOGLE_CLOUD_PROJECT || process.env.GCP_PROJECT || '';
    if (!projectId) {
      return res.status(500).json({ error: 'GOOGLE_CLOUD_PROJECT not set' });
    }

    const region = process.env.GCP_REGION || 'europe-west3';

    // Resolve provenance
    var gitCommit = req.body.gitCommit || '';
    if (!gitCommit) gitCommit = detectGitCommit();
    var releaseNotes = (req.body.releaseNotes || '').trim();

    dep.status = 'deploying';
    dep.error = '';
    await dep.save();

    // Trigger build asynchronously
    var result;
    try {
      result = await gcp.triggerDeployBuild(
        projectId, region, dep.serviceName,
        dep.storeName, dep.mongoUri, Object.fromEntries(dep.env || new Map()),
        gitCommit
      );
    } catch (buildErr) {
      dep.versions.push({
        version:     dep.version || '0.0.0',
        imageTag:    dep.imageTag || '',
        gitCommit:   gitCommit || '',
        releaseNotes: releaseNotes,
        buildId:     '',
        deployedAt:  new Date(),
        deployedBy:  req.user.userId,
        status:      'failed'
      });
      dep.status = 'failed';
      dep.error = buildErr.message.slice(0, 500);
      await dep.save();
      await recordAudit(dep._id, 'deploy', 'failed', releaseNotes || 'Build trigger failed', req.user, { error: dep.error, ip: req.ip });
      return res.status(500).json({ error: dep.error });
    }

    dep.buildId = result.buildId;
    dep.imageTag = result.imageTag;
    dep.gitCommit = gitCommit;
    dep.version = result.buildId;
    dep.deployedAt = new Date();
    dep.status = 'deploying';
    await dep.save();

    // Track active poll to prevent duplicates
    if (!activePolls) activePolls = {};
    if (activePolls[dep._id]) {
      // Previous poll still running — let it handle this build too (race-safe)
    }
    activePolls[dep._id] = true;

    // Start polling for build completion (fire-and-forget)
    pollBuildStatus(dep._id, projectId, result.buildId, gitCommit, releaseNotes, req.user.userId);

    res.json({ message: 'Deploy started', buildId: result.buildId, deployment: dep });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

/**
 * Poll Cloud Build status and update deployment record.
 * Records a version entry on completion.
 */
async function pollBuildStatus(deploymentId, projectId, buildId, gitCommit, releaseNotes, userId) {
  const gcp = getGcpAdmin();
  if (!gcp) return;

  var maxPolls = 60;
  var versionRecorded = false;

  for (var i = 0; i < maxPolls; i++) {
    await new Promise(function(r) { setTimeout(r, 5000); });
    try {
      const build = await gcp.getBuildStatus(projectId, buildId);
      var status = build.status;

      if (status === 'SUCCESS') {
        // Load deployment to get service name for URL/revision fetch
        var currentDep = null;
        try { currentDep = await Deployment.findById(deploymentId); } catch (e) {}
        var svcName = currentDep ? currentDep.serviceName : '';
        var cloudRunUrl = currentDep ? (currentDep.cloudRunUrl || '') : '';

        // Fetch actual Cloud Run URL and revision name
        if (svcName) {
          const actualUrl = await gcp.getServiceUrl(projectId, process.env.GCP_REGION || 'europe-west3', svcName);
          if (actualUrl) cloudRunUrl = actualUrl;
        }
        var revisionName = svcName ? await gcp.getLatestReadyRevision(projectId, process.env.GCP_REGION || 'europe-west3', svcName) : '';

        const update = {
          status: 'running',
          cloudRunUrl: cloudRunUrl || ''
        };

        // Record version entry once
        if (!versionRecorded) {
          var entry = {
            version:      buildId,
            imageTag:     currentDep ? (currentDep.imageTag || '') : '',
            gitCommit:    gitCommit || '',
            releaseNotes: releaseNotes || '',
            buildId:      buildId,
            deployedAt:   new Date(),
            deployedBy:   userId,
            status:       'success',
            revisionName: revisionName,
            dockerImage:  currentDep ? (currentDep.imageTag || '') : ''
          };
          try {
            const dep = await Deployment.findById(deploymentId);
            if (dep) {
              entry.imageTag = dep.imageTag || '';
              entry.dockerImage = dep.imageTag || '';
              dep.versions.push(entry);
              dep.set(update);
              await dep.save();
              versionRecorded = true;
              try { await recordAudit(deploymentId, 'deploy', 'success', releaseNotes || 'Deploy completed', { userId: userId }, {}); } catch (e) {}
              delete activePolls[deploymentId];
              return;
            }
          } catch (e) { /* Fallback: just update status */ }
        }

        await Deployment.findByIdAndUpdate(deploymentId, update);
        delete activePolls[deploymentId];
        return;
      }

      if (status === 'FAILURE' || status === 'TIMEOUT' || status === 'CANCELLED' || status === 'INTERNAL_ERROR') {
        var errMsg = 'Build ' + status;
        if (build.failureInfo && build.failureInfo.detail) errMsg += ': ' + build.failureInfo.detail;

        var updateErr = { status: 'failed', error: errMsg };

        if (!versionRecorded) {
          var entryErr = {
            version:      buildId,
            imageTag:     '',
            gitCommit:    gitCommit || '',
            releaseNotes: releaseNotes || '',
            buildId:      buildId,
            deployedAt:   new Date(),
            deployedBy:   userId,
            status:       'failed'
          };
          try {
            const dep = await Deployment.findById(deploymentId);
            if (dep) {
              entryErr.imageTag = dep.imageTag || '';
              dep.versions.push(entryErr);
              dep.set(updateErr);
              await dep.save();
              versionRecorded = true;
              delete activePolls[deploymentId];
              return;
            }
          } catch (e) {}
        }

        await Deployment.findByIdAndUpdate(deploymentId, updateErr);
        delete activePolls[deploymentId];
        return;
      }
    } catch (e) {
      // Transient error — keep polling
    }
  }
  // Polling exhausted without terminal status — deployment stays 'deploying'.
  // 30-min auto-recovery in deploy route will handle this.
  delete activePolls[deploymentId];
}

// ─── Version history routes ─────────────────────────────────────────────────

// GET /api/saas/deployments/:id/versions — list version history
router.get('/:id/versions', superAdminAuth, async (req, res) => {
  try {
    const dep = await Deployment.findById(req.params.id).select('storeName serviceName versions');
    if (!dep) return res.status(404).json({ error: 'Deployment not found' });

    // Return newest first
    var versions = (dep.versions || []).slice().sort(function(a, b) {
      return new Date(b.deployedAt).getTime() - new Date(a.deployedAt).getTime();
    });

    res.json({
      storeName:   dep.storeName,
      serviceName: dep.serviceName,
      total:       versions.length,
      versions:    versions
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// PUT /api/saas/deployments/:id/versions/:versionId/notes — update release notes
router.put('/:id/versions/:versionId/notes', superAdminAuth, async (req, res) => {
  try {
    var notes = (req.body.releaseNotes || '').trim().slice(0, 2000);
    var dep = await Deployment.findOneAndUpdate(
      { _id: req.params.id, 'versions._id': req.params.versionId },
      { $set: { 'versions.$.releaseNotes': notes } },
      { new: true }
    );
    if (!dep) return res.status(404).json({ error: 'Deployment or version not found' });

    res.json({ success: true, releaseNotes: notes });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// POST /api/saas/deployments/:id/restart — restart Cloud Run service
router.post('/:id/restart', dangerousActionLimiter, superAdminAuth, async (req, res) => {
  try {
    const dep = await Deployment.findById(req.params.id);
    if (!dep) return res.status(404).json({ error: 'Deployment not found' });

    const gcp = getGcpAdmin();
    if (!gcp) {
      return res.status(501).json({ error: 'GCP admin utils not available' });
    }

    const projectId = process.env.GOOGLE_CLOUD_PROJECT || process.env.GCP_PROJECT || '';
    const region = process.env.GCP_REGION || 'europe-west3';

    // Force a new revision by updating a label or annotation
    const patchBody = {
      spec: {
        template: {
          metadata: {
            annotations: {
              'client.knative.dev/user-image': dep.imageTag || dep.cloudRunUrl
            }
          }
        }
      }
    };

    await gcp.updateCloudRunService(projectId, region, dep.serviceName,
      'spec.template.metadata.annotations', patchBody);

    dep.lastRestartAt = new Date();
    dep.status = 'running';
    dep.error = '';
    await dep.save();

    res.json({ message: 'Restart triggered', deployment: dep });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// POST /api/saas/deployments/:id/suspend — scale to 0 (requires PIN)
router.post('/:id/suspend', suspendLimiter, superAdminAuth, async (req, res) => {
  try {
    const dep = await Deployment.findById(req.params.id);
    if (!dep) return res.status(404).json({ error: 'Deployment not found' });

    var reason = await verifyDangerousAction(req, res, dep, 'suspend');
    if (!reason) return;

    const gcp = getGcpAdmin();
    if (!gcp) {
      return res.status(501).json({ error: 'GCP admin utils not available' });
    }

    const projectId = process.env.GOOGLE_CLOUD_PROJECT || process.env.GCP_PROJECT || '';
    const region = process.env.GCP_REGION || 'europe-west3';

    const patchBody = {
      spec: {
        template: {
          metadata: {
            annotations: {
              'autoscaling.knative.dev/minScale': '0',
              'autoscaling.knative.dev/maxScale': '0'
            }
          }
        }
      }
    };

    await gcp.updateCloudRunService(projectId, region, dep.serviceName,
      'spec.template.metadata.annotations', patchBody);

    dep.status = 'suspended';
    await dep.save();
    await recordAudit(dep._id, 'suspend', 'success', reason, req.user, { ip: req.ip });

    res.json({ message: 'Service suspended (scaled to 0)', deployment: dep });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// POST /api/saas/deployments/:id/activate — restore from suspension (requires PIN)
router.post('/:id/activate', activateLimiter, superAdminAuth, async (req, res) => {
  try {
    const dep = await Deployment.findById(req.params.id);
    if (!dep) return res.status(404).json({ error: 'Deployment not found' });

    var subCheck = await enforceSubscriptionExpiry(dep);
    if (subCheck.expired) {
      return res.status(403).json({ error: 'Cannot activate: subscription is ' + dep.subscriptionStatus + '. Extend subscription first.' });
    }

    var reason = await verifyDangerousAction(req, res, dep, 'activate');
    if (!reason) return;

    const gcp = getGcpAdmin();
    if (!gcp) {
      return res.status(501).json({ error: 'GCP admin utils not available' });
    }

    const projectId = process.env.GOOGLE_CLOUD_PROJECT || process.env.GCP_PROJECT || '';
    const region = process.env.GCP_REGION || 'europe-west3';

    const patchBody = {
      spec: {
        template: {
          metadata: {
            annotations: {
              'autoscaling.knative.dev/minScale': '0',
              'autoscaling.knative.dev/maxScale': '10'
            }
          }
        }
      }
    };

    await gcp.updateCloudRunService(projectId, region, dep.serviceName,
      'spec.template.metadata.annotations', patchBody);

    dep.status = 'running';
    await dep.save();
    await recordAudit(dep._id, 'activate', 'success', reason, req.user, { ip: req.ip });

    res.json({ message: 'Service activated', deployment: dep });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// POST /api/saas/deployments/:id/freeze — freeze deployment to read-only (requires PIN)
// Sets STORE_FROZEN env var on Cloud Run service, blocking all write operations.
router.post('/:id/freeze', dangerousActionLimiter, superAdminAuth, async (req, res) => {
  try {
    const dep = await Deployment.findById(req.params.id);
    if (!dep) return res.status(404).json({ error: 'Deployment not found' });
    if (dep.status === 'suspended') return res.status(400).json({ error: 'Cannot freeze a suspended deployment. Activate first.' });

    var reason = await verifyDangerousAction(req, res, dep, 'freeze');
    if (!reason) return;

    const gcp = getGcpAdmin();
    if (!gcp) return res.status(501).json({ error: 'GCP admin utils not available' });

    const projectId = process.env.GOOGLE_CLOUD_PROJECT || process.env.GCP_PROJECT || '';
    if (!projectId) return res.status(500).json({ error: 'GOOGLE_CLOUD_PROJECT not set' });
    const region = process.env.GCP_REGION || 'europe-west3';

    try {
      await gcp.updateServiceEnv(projectId, region, dep.serviceName, { STORE_FROZEN: 'true' });
    } catch (envErr) {
      await recordAudit(dep._id, 'freeze', 'failed', reason, req.user, { error: envErr.message, ip: req.ip });
      return res.status(500).json({ error: 'Failed to set freeze env: ' + envErr.message });
    }

    dep.status = 'readonly_frozen';
    await dep.save();
    await recordAudit(dep._id, 'freeze', 'success', reason, req.user, { ip: req.ip });

    res.json({ message: 'Deployment frozen to read-only. POS will restart to apply.', deployment: dep });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// POST /api/saas/deployments/:id/unfreeze — restore from read-only freeze (requires PIN)
router.post('/:id/unfreeze', dangerousActionLimiter, superAdminAuth, async (req, res) => {
  try {
    const dep = await Deployment.findById(req.params.id);
    if (!dep) return res.status(404).json({ error: 'Deployment not found' });
    if (dep.status !== 'readonly_frozen') return res.status(400).json({ error: 'Deployment is not frozen' });

    var reason = await verifyDangerousAction(req, res, dep, 'unfreeze');
    if (!reason) return;

    const gcp = getGcpAdmin();
    if (!gcp) return res.status(501).json({ error: 'GCP admin utils not available' });

    const projectId = process.env.GOOGLE_CLOUD_PROJECT || process.env.GCP_PROJECT || '';
    if (!projectId) return res.status(500).json({ error: 'GOOGLE_CLOUD_PROJECT not set' });
    const region = process.env.GCP_REGION || 'europe-west3';

    try {
      await gcp.updateServiceEnv(projectId, region, dep.serviceName, { STORE_FROZEN: null });
    } catch (envErr) {
      await recordAudit(dep._id, 'unfreeze', 'failed', reason, req.user, { error: envErr.message, ip: req.ip });
      return res.status(500).json({ error: 'Failed to remove freeze env: ' + envErr.message });
    }

    dep.status = 'running';
    await dep.save();
    await recordAudit(dep._id, 'unfreeze', 'success', reason, req.user, { ip: req.ip });

    res.json({ message: 'Deployment unfrozen. POS will restart to apply.', deployment: dep });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// POST /api/saas/deployments/:id/rollback — rollback via Cloud Run traffic switch (requires PIN)
// Does NOT rebuild containers. Instantly switches traffic to a previous revision.
router.post('/:id/rollback', rollbackLimiter, superAdminAuth, async (req, res) => {
  try {
    const dep = await Deployment.findById(req.params.id);
    if (!dep) return res.status(404).json({ error: 'Deployment not found' });

    var reason = await verifyDangerousAction(req, res, dep, 'rollback');
    if (!reason) return;

    // Find target version — by ID or latest previous successful
    var targetVersion = null;
    if (req.body.targetVersionId) {
      targetVersion = dep.versions.id(req.body.targetVersionId);
    } else {
      var sorted = (dep.versions || []).slice().sort(function(a, b) {
        return new Date(b.deployedAt).getTime() - new Date(a.deployedAt).getTime();
      });
      for (var i = 1; i < sorted.length; i++) {
        if (sorted[i].status === 'success') { targetVersion = sorted[i]; break; }
      }
    }
    if (!targetVersion) {
      return res.status(404).json({ error: 'No previous version found for rollback' });
    }

    // Must have a revision name to switch traffic to
    if (!targetVersion.revisionName) {
      return res.status(400).json({ error: 'Target version has no revision metadata. Rebuild-based rollback required.' });
    }

    const gcp = getGcpAdmin();
    if (!gcp) {
      return res.status(501).json({ error: 'GCP admin utils not available (google-auth-library missing)' });
    }

    const projectId = process.env.GOOGLE_CLOUD_PROJECT || process.env.GCP_PROJECT || '';
    if (!projectId) return res.status(500).json({ error: 'GOOGLE_CLOUD_PROJECT not set' });
    const region = process.env.GCP_REGION || 'europe-west3';

    // Get current revision name before switching
    var currentRevision = dep.versions.length > 0
      ? dep.versions[dep.versions.length - 1].revisionName || ''
      : '';

    // Switch traffic to target revision
    try {
      await gcp.switchTraffic(projectId, region, dep.serviceName, targetVersion.revisionName, 100);
    } catch (trafficErr) {
      await recordAudit(dep._id, 'rollback', 'failed', reason, req.user, { error: trafficErr.message, ip: req.ip });
      return res.status(500).json({ error: 'Traffic switch failed: ' + trafficErr.message });
    }

    // Record rollback version entry (no rebuild occurred)
    var rollbackEntry = {
      version:      'rollback-' + targetVersion.version,
      imageTag:     targetVersion.imageTag || dep.imageTag || '',
      gitCommit:    targetVersion.gitCommit || '',
      releaseNotes: 'Rollback to v' + targetVersion.version + ': ' + reason,
      buildId:      'traffic-switch',
      deployedAt:   new Date(),
      deployedBy:   req.user.userId,
      status:       'success',
      revisionName: targetVersion.revisionName,
      dockerImage:  targetVersion.dockerImage || targetVersion.imageTag || ''
    };

    dep.versions.push(rollbackEntry);
    dep.status = 'running';
    dep.error = '';
    dep.deployedAt = new Date();
    await dep.save();

    await recordAudit(dep._id, 'rollback', 'success', reason, req.user, {
      fromRevision: currentRevision,
      toRevision:   targetVersion.revisionName,
      fromVersion:  dep.versions.length > 1 ? dep.versions[dep.versions.length - 2].version : '',
      toVersion:    targetVersion.version,
      ip: req.ip
    });

    res.json({
      message: 'Rollback complete — traffic switched to revision ' + targetVersion.revisionName,
      targetVersion: targetVersion.version,
      targetRevision: targetVersion.revisionName,
      deployment: dep
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// POST /api/saas/deployments/:id/restore-backup — restore from backup (requires PIN)
// Stub — actual backup/restore logic depends on infrastructure setup.
router.post('/:id/restore-backup', dangerousActionLimiter, superAdminAuth, async (req, res) => {
  try {
    const dep = await Deployment.findById(req.params.id);
    if (!dep) return res.status(404).json({ error: 'Deployment not found' });

    var reason = await verifyDangerousAction(req, res, dep, 'restore-backup');
    if (!reason) return;

    await recordAudit(dep._id, 'restore-backup', 'success', reason, req.user, { ip: req.ip });

    res.json({ message: 'Backup restore not yet implemented. Audit logged.', deploymentId: dep._id });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// GET /api/saas/deployments/:id/audit — list audit log for a deployment
router.get('/:id/audit', superAdminAuth, async (req, res) => {
  try {
    const dep = await Deployment.findById(req.params.id).select('storeName serviceName');
    if (!dep) return res.status(404).json({ error: 'Deployment not found' });

    var logs = await DeploymentAudit.find({ deploymentId: req.params.id })
      .sort({ createdAt: -1 })
      .limit(100)
      .select('-__v');

    res.json({
      storeName:   dep.storeName,
      serviceName: dep.serviceName,
      total:       logs.length,
      entries:     logs
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// GET /api/saas/deployments/:id/logs — get logs URL or recent log snippet
router.get('/:id/logs', superAdminAuth, async (req, res) => {
  try {
    const dep = await Deployment.findById(req.params.id);
    if (!dep) return res.status(404).json({ error: 'Deployment not found' });

    const projectId = process.env.GOOGLE_CLOUD_PROJECT || process.env.GCP_PROJECT || '';
    const region = process.env.GCP_REGION || 'europe-west3';

    var logsUrl = '';
    var buildLogsUrl = '';

    // Build logs URL (if build was triggered)
    if (dep.buildId) {
      buildLogsUrl = 'https://console.cloud.google.com/cloud-build/builds;region=global/' + dep.buildId + '?project=' + projectId;
    }

    // Cloud Run logs URL
    if (dep.serviceName) {
      logsUrl = 'https://console.cloud.google.com/run/detail/' + region + '/' + dep.serviceName + '/logs?project=' + projectId;
    }

    res.json({
      serviceName: dep.serviceName,
      cloudRunUrl: dep.cloudRunUrl,
      logsUrl: logsUrl,
      buildLogsUrl: buildLogsUrl
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// POST /api/saas/deployments/:id/refresh-status — refresh status from Cloud Run
router.post('/:id/refresh-status', superAdminAuth, async (req, res) => {
  try {
    const dep = await Deployment.findById(req.params.id);
    if (!dep) return res.status(404).json({ error: 'Deployment not found' });

    const gcp = getGcpAdmin();
    if (!gcp) {
      return res.status(501).json({ error: 'GCP admin utils not available' });
    }

    const projectId = process.env.GOOGLE_CLOUD_PROJECT || process.env.GCP_PROJECT || '';
    const region = process.env.GCP_REGION || 'europe-west3';

    try {
      const svc = await gcp.getCloudRunService(projectId, region, dep.serviceName);
      if (svc && svc.status) {
        dep.cloudRunUrl = svc.status.url || dep.cloudRunUrl;
        dep.status = 'running';
        dep.error = '';
      }
    } catch (e) {
      // Service not found or not accessible
      if (dep.status === 'deploying' || dep.status === 'pending') {
        // Keep current status
      } else {
        dep.status = 'failed';
        dep.error = 'Service not accessible: ' + e.message.slice(0, 200);
      }
    }

    await dep.save();
    res.json(dep);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ─── Subscription management ──────────────────────────────────────────────────

// POST /api/saas/deployments/check-subscriptions — auto-freeze expired subscriptions
// Runs expiry check: when current date > subscriptionExpiresAt + gracePeriodDays,
// automatically freezes the deployment (sets readonly_frozen status + Cloud Run env).
router.post('/check-subscriptions', superAdminAuth, async (req, res) => {
  try {
    var now = new Date();
    var frozen = [];

    // Find subscriptions past expiry + grace period
    var expiring = await Deployment.find({
      subscriptionStatus: { $in: ['trial', 'active'] },
      subscriptionExpiresAt: { $ne: null }
    }).sort({ updatedAt: -1 }).limit(20);

    for (var i = 0; i < expiring.length; i++) {
      var dep = expiring[i];
      if (!dep.subscriptionExpiresAt) continue;
      var graceEnd = new Date(dep.subscriptionExpiresAt.getTime() + (dep.gracePeriodDays || 7) * 24 * 60 * 60 * 1000);
      if (now <= graceEnd) continue;

      // Set readonly_frozen on Cloud Run if not already
      if (dep.status !== 'readonly_frozen' && dep.status !== 'suspended') {
        const gcp = getGcpAdmin();
        if (gcp && dep.cloudRunUrl) {
          var projectId = process.env.GOOGLE_CLOUD_PROJECT || process.env.GCP_PROJECT || '';
          var region = process.env.GCP_REGION || 'europe-west3';
          try {
            await gcp.updateServiceEnv(projectId, region, dep.serviceName, { STORE_FROZEN: 'true' });
          } catch (envErr) {
            // Non-fatal — still mark frozen in DB
          }
        }
      }

      dep.subscriptionStatus = 'expired';
      if (dep.status === 'running') dep.status = 'readonly_frozen';
      dep.error = 'Auto-frozen: subscription expired on ' + dep.subscriptionExpiresAt.toISOString().slice(0, 10);
      await dep.save();
      await recordAudit(dep._id, 'subscription-expire', 'success', 'Auto-frozen: subscription expired', {}, {
        subscriptionExpiresAt: dep.subscriptionExpiresAt,
        gracePeriodDays: dep.gracePeriodDays
      });
      frozen.push({ id: dep._id, storeName: dep.storeName });
    }

    // Also freeze deployments that were missed (status still running but subscription gone)
    var sweepResult = await Deployment.updateMany(
      {
        subscriptionStatus: { $in: ['expired', 'readonly_frozen'] },
        status: 'running'
      },
      { status: 'readonly_frozen', error: 'Auto-frozen: subscription expired' }
    );

    res.json({
      checked: expiring.length,
      frozen: frozen.length,
      swept: sweepResult.modifiedCount || 0,
      details: frozen
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// PUT /api/saas/deployments/:id/subscription — update subscription (super admin only)
// Requires PIN + reason. Allows extending, shortening, or reactivating.
router.put('/:id/subscription', dangerousActionLimiter, superAdminAuth, async (req, res) => {
  try {
    const dep = await Deployment.findById(req.params.id);
    if (!dep) return res.status(404).json({ error: 'Deployment not found' });

    var reason = await verifyDangerousAction(req, res, dep, 'subscription-update');
    if (!reason) return;

    var { subscriptionExpiresAt, subscriptionStatus, gracePeriodDays } = req.body;
    var updates = {};
    var changes = [];

    // Validate and set subscription expiry
    if (subscriptionExpiresAt) {
      var newExpiry = new Date(subscriptionExpiresAt);
      if (isNaN(newExpiry.getTime())) {
        return res.status(400).json({ error: 'Invalid subscriptionExpiresAt date' });
      }
      var start = dep.subscriptionStart || new Date();
      var maxDuration = 10 * 365 * 24 * 60 * 60 * 1000; // 10 years
      if (newExpiry.getTime() - start.getTime() > maxDuration) {
        return res.status(400).json({ error: 'Subscription duration cannot exceed 10 years' });
      }
      if (newExpiry < new Date()) {
        // Shortening — warn but allow
        changes.push('Expiry shortened to ' + newExpiry.toISOString().slice(0, 10));
      } else {
        changes.push('Expiry extended to ' + newExpiry.toISOString().slice(0, 10));
      }
      updates.subscriptionExpiresAt = newExpiry;
    }

    // Validate and set subscription status
    var VALID_STATUSES = ['trial', 'active', 'expired', 'readonly_frozen', 'suspended', 'deleted'];
    if (subscriptionStatus) {
      if (VALID_STATUSES.indexOf(subscriptionStatus) === -1) {
        return res.status(400).json({ error: 'Invalid subscriptionStatus. Valid: ' + VALID_STATUSES.join(', ') });
      }
      changes.push('Status: ' + dep.subscriptionStatus + ' → ' + subscriptionStatus);
      updates.subscriptionStatus = subscriptionStatus;

      // Reactivation: if setting to active/trial, unfreeze deployment if frozen due to subscription
      if ((subscriptionStatus === 'active' || subscriptionStatus === 'trial') && dep.status === 'readonly_frozen') {
        updates.status = 'running';
        updates.error = '';
        changes.push('Deployment unfrozen (reactivated)');
      }
    }

    // Set grace period
    if (gracePeriodDays != null) {
      var gp = Number(gracePeriodDays);
      if (isNaN(gp) || gp < 0 || gp > 365) {
        return res.status(400).json({ error: 'gracePeriodDays must be 0-365' });
      }
      changes.push('Grace period: ' + (dep.gracePeriodDays || 7) + ' → ' + gp + ' days');
      updates.gracePeriodDays = gp;
    }

    if (Object.keys(updates).length === 0) {
      return res.status(400).json({ error: 'No valid subscription fields to update' });
    }

    Object.assign(dep, updates);
    await dep.save();

    await recordAudit(dep._id, 'subscription-update', 'success', reason, req.user, {
      changes: changes,
      ip: req.ip
    });

    res.json({
      success: true,
      message: changes.join('; '),
      subscription: {
        start: dep.subscriptionStart,
        expiresAt: dep.subscriptionExpiresAt,
        status: dep.subscriptionStatus,
        gracePeriodDays: dep.gracePeriodDays
      },
      deployment: dep
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ─── Health check ─────────────────────────────────────────────────────────

/**
 * Simple HTTPS GET using native https module (no node-fetch dependency).
 * Returns { statusCode, body } or throws on network/timeout error.
 */
function httpsGet(urlStr, timeoutMs) {
  return new Promise(function(resolve, reject) {
    var http = require('http');
    var https = require('https');
    var url = require('url').parse(urlStr);
    var transport = url.protocol === 'https:' ? https : http;
    var opts = {
      hostname: url.hostname,
      path: url.pathname + (url.search || ''),
      method: 'GET',
      timeout: timeoutMs || 10000,
      headers: { 'Accept': 'application/json' }
    };
    var req = transport.request(opts, function(res) {
      var data = '';
      res.on('data', function(chunk) { data += chunk; });
      res.on('end', function() { resolve({ statusCode: res.statusCode, body: data }); });
    });
    req.on('error', reject);
    req.on('timeout', function() { req.destroy(); reject(new Error('Request timeout')); });
    req.end();
  });
}

// POST /api/saas/deployments/check-all-health — poll health for all active deployments
// Lightweight: no aggregation, no heavy queries, just HTTP GET + mongoose update.
router.post('/check-all-health', healthLimiter, superAdminAuth, async (req, res) => {
  try {
    var deps = await Deployment.find({
      status: { $in: ['running', 'readonly_frozen', 'deploying'] }
    }).limit(50).select('storeName serviceName cloudRunUrl lastHealthStatus lastSuccessfulHealthCheck lastMongoStatus healthLatency');

    var results = [];
    var now = new Date();
    var fiveMinAgo = new Date(now.getTime() - 5 * 60 * 1000);

    for (var i = 0; i < deps.length; i++) {
      var dep = deps[i];
      if (!dep.cloudRunUrl) {
        results.push({ id: dep._id, storeName: dep.storeName, healthStatus: 'unknown', reason: 'no cloudRunUrl' });
        continue;
      }

      var start = Date.now();
      try {
        var resp = await httpsGet(dep.cloudRunUrl + '/api/health');
        var latency = Date.now() - start;

        if (resp.statusCode >= 200 && resp.statusCode < 400) {
          var data = JSON.parse(resp.body);

          dep.lastHealthCheck = now;
          dep.lastSuccessfulHealthCheck = now;
          dep.lastHealthStatus = 'healthy';
          dep.lastMongoStatus = data.mongo != null ? data.mongo : -1;
          dep.healthLatency = latency;
          dep.lastHealthError = '';
          await dep.save();

          results.push({ id: dep._id, storeName: dep.storeName, healthStatus: 'healthy', latency: latency });
        } else {
          throw new Error('HTTP ' + resp.statusCode);
        }
      } catch (e) {
        dep.lastHealthCheck = now;
        dep.lastHealthError = (e.message || 'unknown error').slice(0, 200);
        dep.healthLatency = Date.now() - start;

        // Offline if never had success or last success >5 min ago
        if (!dep.lastSuccessfulHealthCheck || dep.lastSuccessfulHealthCheck < fiveMinAgo) {
          dep.lastHealthStatus = 'offline';
        }
        await dep.save();

        results.push({ id: dep._id, storeName: dep.storeName, healthStatus: dep.lastHealthStatus, error: dep.lastHealthError });
      }
    }

    // Sweep: mark deployments offline if lastSuccessfulHealthCheck >5 min stale (missed by loop)
    var sweepResult = await Deployment.updateMany(
      {
        status: { $in: ['running', 'readonly_frozen'] },
        lastSuccessfulHealthCheck: { $lt: fiveMinAgo },
        lastHealthStatus: { $ne: 'offline' }
      },
      { lastHealthStatus: 'offline' }
    );

    // Subscription expiry check: auto-freeze deployments past grace period
    var subscriptionFreezeCount = 0;
    var expiredDeps = await Deployment.find({
      subscriptionStatus: { $in: ['trial', 'active'] },
      subscriptionExpiresAt: { $ne: null, $lt: now } // Past expiry, loop checks actual grace
    }).limit(10).select('_id storeName subscriptionExpiresAt subscriptionStatus status gracePeriodDays');

    for (var si = 0; si < expiredDeps.length; si++) {
      var eDep = expiredDeps[si];
      if (!eDep.subscriptionExpiresAt) continue;
      var graceEnd = new Date(eDep.subscriptionExpiresAt.getTime() + (eDep.gracePeriodDays || 7) * 24 * 60 * 60 * 1000);
      if (now <= graceEnd) continue;
      eDep.subscriptionStatus = 'expired';
      if (eDep.status === 'running') eDep.status = 'readonly_frozen';
      await eDep.save();
      subscriptionFreezeCount++;
    }

    res.json({
      checked: results.length,
      results: results,
      staleMarkedOffline: sweepResult.modifiedCount || 0,
      subscriptionFreezeCount: subscriptionFreezeCount
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

module.exports = router;
