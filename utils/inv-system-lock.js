/**
 * System Lock Middleware & Utility
 *
 * Enforces system-wide safe mode at the service layer.
 * All financial operations MUST call requireSystemActive() before
 * executing any writes.
 *
 * RUNBOOK §3 Rule A: No frontend bypass. Rule D: Atomic operations.
 * SOFT_FREEZE_POLICY §2: Financial core is frozen — we only add safety checks.
 */

const SystemState = require('../models/inv/SystemState');

const LOCK_ERRORS = Object.freeze({
  PAUSED: { code: 'SYSTEM_PAUSED', message: 'System is paused. POS operations are blocked.' },
  LOCKED: { code: 'SYSTEM_LOCKED', message: 'System is LOCKED. All financial operations are blocked until a root user unlocks the system.' },
});

/**
 * Check if the system is in ACTIVE state.
 * Throws with SYSTEM_PAUSED or SYSTEM_LOCKED error if not active.
 *
 * Used in service layer entry points (checkout, refund, daily-close, etc.).
 * Also used as Express middleware for routes.
 */
async function requireSystemActive() {
  const state = await SystemState.findById('global');
  if (!state) return; // No state document = fresh system, allow operations

  if (state.status === 'LOCKED') {
    const err = new Error(LOCK_ERRORS.LOCKED.message);
    err.code = LOCK_ERRORS.LOCKED.code;
    err.status = state.status;
    err.lockInfo = { reason: state.reason, triggeredBy: state.triggeredBy, timestamp: state.timestamp };
    throw err;
  }

  if (state.status === 'PAUSED') {
    const err = new Error(LOCK_ERRORS.PAUSED.message);
    err.code = LOCK_ERRORS.PAUSED.code;
    err.status = state.status;
    err.lockInfo = { reason: state.reason, triggeredBy: state.triggeredBy, timestamp: state.timestamp };
    throw err;
  }
}

/**
 * Express middleware wrapper for requireSystemActive().
 * Catches lock errors and returns 503 with structured JSON.
 */
function requireSystemActiveMiddleware(req, res, next) {
  requireSystemActive()
    .then(() => next())
    .catch(err => {
      const statusCode = err.code === 'SYSTEM_LOCKED' ? 503 : 503;
      res.status(statusCode).json({
        error: err.message,
        code: err.code,
        status: err.status,
        lockInfo: err.lockInfo || null,
      });
    });
}

/**
 * Get the current system state document.
 */
async function getSystemState() {
  const state = await SystemState.findById('global');
  if (!state) return { status: 'ACTIVE', reason: '', triggeredBy: null, timestamp: null };
  return state;
}

module.exports = { requireSystemActive, requireSystemActiveMiddleware, getSystemState, LOCK_ERRORS };
