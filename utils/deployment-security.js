const bcrypt = require('bcryptjs');
const DeploymentAudit = require('../models/saas/DeploymentAudit');
const Deployment = require('../models/saas/Deployment');

/**
 * Supported timezones for dynamic code verification.
 */
var SUPPORTED_TIMEZONES = [
  'Europe/Dublin',
  'Europe/London',
  'America/New_York',
  'Asia/Shanghai'
];

function isTimezoneSupported(tz) {
  return SUPPORTED_TIMEZONES.indexOf(tz) !== -1;
}

/**
 * Get local time HHMM string for a given timezone.
 */
function getLocalHHMM(date, timezone) {
  var d = date || new Date();
  var tz = timezone || 'Europe/Dublin';
  try {
    var parts = new Intl.DateTimeFormat('en-GB', {
      timeZone: tz,
      hour: '2-digit',
      minute: '2-digit',
      hour12: false
    }).formatToParts(d);

    var h = '', m = '';
    for (var i = 0; i < parts.length; i++) {
      if (parts[i].type === 'hour')   h = parts[i].value;
      if (parts[i].type === 'minute') m = parts[i].value;
    }
    return h + m;
  } catch (e) {
    // Fallback to UTC if timezone is invalid
    var fallback = '' + d.getUTCHours() + d.getUTCMinutes();
    return ('00' + d.getUTCHours()).slice(-2) + ('00' + d.getUTCMinutes()).slice(-2);
  }
}

/**
 * Generate array of acceptable HHMM codes with ±tolerance minutes for a timezone.
 */
function getLocalHHMMRange(toleranceMinutes, timezone) {
  var tol = toleranceMinutes == null ? 1 : toleranceMinutes;
  var codes = [];
  for (var offset = -tol; offset <= tol; offset++) {
    var d = new Date(Date.now() + offset * 60000);
    codes.push(getLocalHHMM(d, timezone));
  }
  return codes.filter(function(c, i) { return codes.indexOf(c) === i; });
}

/**
 * Verify a dangerous-action code.
 * Code format: <4-digit HHMM><4-20 digit deployment PIN>
 * Uses the store's configured timezone for the HHMM portion.
 * Example: Store timezone is Europe/London, local time=22:41, PIN=4825, code=22414825
 *
 * @param {Object} dep — Deployment document (must have pinHash and timezone)
 * @param {string} enteredCode — full code entered by admin
 * @param {number} toleranceMinutes — ±minutes for time window (default 1)
 * @returns {Object} { valid: bool, error: string }
 */
async function verifyActionCode(dep, enteredCode, toleranceMinutes) {
  if (!dep || !dep.pinHash) {
    return { valid: false, error: 'No deployment PIN configured. Set a PIN first.' };
  }

  if (!enteredCode || enteredCode.length < 8) {
    return { valid: false, error: 'Code must be at least 8 digits (HHMM + PIN).' };
  }

  if (!/^\d+$/.test(enteredCode)) {
    return { valid: false, error: 'Code must contain only digits.' };
  }

  var tol = toleranceMinutes == null ? 1 : toleranceMinutes;
  var tz = dep.timezone || 'Europe/Dublin';
  var localCodes = getLocalHHMMRange(tol, tz);
  var pinPart = enteredCode.slice(4);

  // Check if the first 4 digits match any valid timezone code
  var enteredHHMM = enteredCode.slice(0, 4);
  var tzValid = false;
  for (var i = 0; i < localCodes.length; i++) {
    if (enteredHHMM === localCodes[i]) {
      tzValid = true;
      break;
    }
  }

  if (!tzValid) {
    return { valid: false, error: 'Invalid time code for ' + tz + '. Expected one of: ' + localCodes.join(', ') };
  }

  // Verify PIN against stored bcrypt hash
  var pinMatch = await bcrypt.compare(pinPart, dep.pinHash);
  if (!pinMatch) {
    return { valid: false, error: 'Invalid deployment PIN.' };
  }

  return { valid: true, error: '' };
}

/**
 * Record an audit log entry for a dangerous action.
 */
async function recordAudit(deploymentId, action, result, reason, adminUser, details) {
  try {
    var dep = await Deployment.findById(deploymentId).select('storeName serviceName status version imageTag');

    var entry = {
      deploymentId: deploymentId,
      storeName:    dep ? dep.storeName : '',
      serviceName:  dep ? dep.serviceName : '',
      action:       action,
      result:       result,
      reason:       reason || '',
      details:      details || {},
      adminUser:    adminUser ? adminUser.userId : null,
      adminName:    adminUser ? (adminUser.username || '') : '',
      snapshot: dep ? {
        status:   dep.status,
        version:  dep.version,
        imageTag: dep.imageTag
      } : {}
    };

    return await DeploymentAudit.create(entry);
  } catch (e) {
    console.error('Audit log write failed:', e.message);
    return null;
  }
}

/**
 * Middleware: verify dangerous action code from request body,
 * then call next() if valid, or return 403.
 *
 * Expects req.body.actionCode and req.body.reason.
 * Sets req.actionVerified = true on success.
 */
function requireActionCode(req, res, next) {
  (async function() {
    var dep = res.locals.dep;
    if (!dep) {
      // Try to load from req.params.id
      dep = await Deployment.findById(req.params.id);
      if (!dep) { res.status(404).json({ error: 'Deployment not found' }); return; }
      res.locals.dep = dep;
    }

    var code = req.body.actionCode;
    var reason = (req.body.reason || '').trim();
    if (!reason) { res.status(400).json({ error: 'Reason required for dangerous action' }); return; }

    var verification = await verifyActionCode(dep, code);
    if (!verification.valid) {
      await recordAudit(dep._id, req.actionName || 'unknown', 'failed', reason, req.user, {
        error: verification.error,
        ip: req.ip
      });
      res.status(403).json({ error: verification.error });
      return;
    }

    req.actionVerified = true;
    req.actionReason = reason;
    next();
  })();
}

module.exports = {
  getLocalHHMM,
  getLocalHHMMRange,
  isTimezoneSupported,
  SUPPORTED_TIMEZONES,
  verifyActionCode,
  recordAudit,
  requireActionCode
};
