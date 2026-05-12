const express = require('express');
const router = express.Router();
const crypto = require('crypto');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const rateLimit = require('express-rate-limit');
const InvUser = require('../../models/inv/User');
const { SYSTEM_ROOTS } = require('../../models/inv/User');
const TrustedDevice = require('../../models/inv/TrustedDevice');
const LoginLog = require('../../models/inv/LoginLog');
const { jwtAuth, requireRole } = require('../../middleware/inv-auth');
const { validatePassword } = require('../../utils/inv-validators');
const { AUDIT_ACTIONS, logAdminAction } = require('../../services/inv-admin-service');

const JWT_SECRET = process.env.INV_JWT_SECRET;
const TOKEN_EXPIRES_IN = '8h';
const BCRYPT_SALT_ROUNDS = 10;
const MAX_FAILED_ATTEMPTS = 5;
const LOCKOUT_DURATION_MS = 15 * 60 * 1000; // 15 minutes
const CAPTCHA_EXPIRY_MS = 5 * 60 * 1000; // 5 minutes
const DEVICE_CAPTCHA_THRESHOLD = 3; // Failed attempts before CAPTCHA required per device
const DEVICE_COOLDOWN_MS = 10 * 60 * 1000; // 10 min device cooldown after failures

// ─── Rate limiter for login (brute-force protection) ─────────────────────────
const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 20,
  message: { error: 'Too many login attempts, please try again later.' },
  standardHeaders: true,
  legacyHeaders: false,
});

// ─── Rate limiter for CAPTCHA (prevent memory exhaustion) ────────────────────
const captchaLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 30,
  message: { error: 'Too many CAPTCHA requests, please try again later.' },
  standardHeaders: true,
  legacyHeaders: false,
});

// ─── Server-side CAPTCHA store ──────────────────────────────────────────────
// Map<captchaId, { answer: number, expiresAt: number }>
const captchaStore = new Map();

// ─── Device failure tracking (in-memory, for unknown devices) ───────────────
// Map<deviceId, { count: number, lastFailedAt: number, cooldownUntil: number }>
const deviceFailureStore = new Map();

function hashIP(ip) {
  if (!ip) return 'unknown';
  return crypto.createHash('sha256').update(ip).digest('hex').slice(0, 16);
}

// Periodic cleanup of expired CAPTCHAs (every 5 minutes)
const captchaCleanupInterval = setInterval(() => {
  const now = Date.now();
  for (const [id, data] of captchaStore) {
    if (now > data.expiresAt) {
      captchaStore.delete(id);
    }
  }
}, CAPTCHA_EXPIRY_MS);
// Unref so the timer doesn't prevent Node.js process from exiting
if (captchaCleanupInterval.unref) {
  captchaCleanupInterval.unref();
}

// ─── POST /api/inv/auth/captcha ─────────────────────────────────────────────
// Generate a simple math CAPTCHA
router.post('/captcha', captchaLimiter, (req, res) => {
  const a = Math.floor(Math.random() * 20) + 1;
  const b = Math.floor(Math.random() * 20) + 1;
  const answer = a + b;
  const captchaId = crypto.randomUUID();
  const question = `${a} + ${b} = ?`;

  captchaStore.set(captchaId, {
    answer,
    expiresAt: Date.now() + CAPTCHA_EXPIRY_MS
  });

  res.json({ captchaId, question });
});

// ─── POST /api/inv/auth/login ───────────────────────────────────────────────
// Validate username, password, and CAPTCHA; handle account lockout
// Supports device trust to skip CAPTCHA for known devices
router.post('/login', loginLimiter, async (req, res) => {
  try {
    const { username, password, captchaId, captchaAnswer, deviceId, trustDevice } = req.body;

    if (!username || !password) {
      return res.status(400).json({ error: '用户名和密码不能为空' });
    }

    // ─── Device trust check ────────────────────────────────────────────────
    let deviceTrusted = false;
    let deviceRecord = null;
    if (deviceId) {
      deviceRecord = await TrustedDevice.findOne({
        deviceId,
        trusted: true,
        revoked: { $ne: true }
      });
      deviceTrusted = !!deviceRecord;
    }

    // ─── CAPTCHA decision ───────────────────────────────────────────────────
    // Trusted devices skip CAPTCHA entirely.
    // Untrusted/unknown devices: check failure count, require CAPTCHA if >= threshold.
    let captchaRequired = false;
    if (!deviceTrusted) {
      if (deviceId) {
        // Check in-memory failure store for unknown devices
        const devFail = deviceFailureStore.get(deviceId);
        if (devFail && devFail.count >= DEVICE_CAPTCHA_THRESHOLD) {
          // Check cooldown
          if (devFail.cooldownUntil && Date.now() < devFail.cooldownUntil) {
            return res.status(429).json({
              error: '该设备登录失败次数过多，请稍后再试',
              captchaRequired: true,
              cooldownRemaining: Math.ceil((devFail.cooldownUntil - Date.now()) / 1000)
            });
          }
          if (Date.now() - devFail.lastFailedAt < 600000) {
            captchaRequired = true;
          }
        }
        // Also check DB device record failures
        if (!captchaRequired && deviceRecord && deviceRecord.failedAttempts >= DEVICE_CAPTCHA_THRESHOLD) {
          captchaRequired = true;
        }
      }
    }

    // Validate CAPTCHA if provided or required
    if (captchaId) {
      // User provided a CAPTCHA answer — validate it
      const captchaData = captchaStore.get(captchaId);
      if (!captchaData) {
        return res.status(400).json({ error: '验证码无效或已过期', captchaRequired: true });
      }
      captchaStore.delete(captchaId);
      if (Date.now() > captchaData.expiresAt) {
        return res.status(400).json({ error: '验证码已过期', captchaRequired: true });
      }
      if (Number(captchaAnswer) !== captchaData.answer) {
        return res.status(400).json({ error: '验证码错误', captchaRequired: true });
      }
    } else if (captchaRequired) {
      // CAPTCHA is required but not provided — tell frontend
      return res.status(400).json({ error: '需要验证码', captchaRequired: true });
    }
    // Note: humanCheck removed — client-sent boolean offers no real protection.
    // LoginLimiter + device failure tracking + CAPTCHA provide the actual defense.

    // Find user
    const user = await InvUser.findOne({ username });

    if (!user) {
      return res.status(401).json({ error: '用户名或密码错误' });
    }

    if (!user.active) {
      return res.status(403).json({ error: '账号已停用，请联系管理员' });
    }

    // Check account lockout
    if (user.lockedUntil && user.lockedUntil > new Date()) {
      const remainingMs = user.lockedUntil.getTime() - Date.now();
      const remainingMin = Math.ceil(remainingMs / 60000);
      return res.status(423).json({
        error: `账号已锁定，请 ${remainingMin} 分钟后再试`,
        lockedUntil: user.lockedUntil,
        remainingMinutes: remainingMin
      });
    }

    // Verify password
    const isMatch = await bcrypt.compare(password, user.password);

    if (!isMatch) {
      // ─── Track device failure ────────────────────────────────────────────
      if (deviceId) {
        // Track in-memory for unknown devices
        const devFail = deviceFailureStore.get(deviceId) || { count: 0, lastFailedAt: 0 };
        devFail.count += 1;
        devFail.lastFailedAt = Date.now();
        if (devFail.count >= MAX_FAILED_ATTEMPTS) {
          devFail.cooldownUntil = Date.now() + DEVICE_COOLDOWN_MS;
        }
        deviceFailureStore.set(deviceId, devFail);

        // Also update DB record if exists
        if (deviceRecord) {
          await TrustedDevice.updateOne(
            { _id: deviceRecord._id },
            { $inc: { failedAttempts: 1 }, $set: { failedAt: new Date() } }
          );
        }
      }

      // Increment user failure count
      const newFailedAttempts = (user.failedAttempts || 0) + 1;

      // Lock account after MAX_FAILED_ATTEMPTS consecutive failures
      if (newFailedAttempts >= MAX_FAILED_ATTEMPTS) {
        await InvUser.findByIdAndUpdate(user._id, {
          failedAttempts: newFailedAttempts,
          lockedUntil: new Date(Date.now() + LOCKOUT_DURATION_MS)
        });
      } else {
        await InvUser.findByIdAndUpdate(user._id, { failedAttempts: newFailedAttempts });
      }

      // Record failed login log
      await LoginLog.create({
        user: user._id,
        username: user.username,
        success: false,
        ip: req.ip,
        userAgent: req.headers['user-agent']
      }).catch(() => {}); // Log write failure should not affect main flow

      if (newFailedAttempts >= MAX_FAILED_ATTEMPTS) {
        return res.status(423).json({
          error: `连续登录失败 ${MAX_FAILED_ATTEMPTS} 次，账号已锁定 15 分钟`,
          remainingMinutes: 15
        });
      }

      return res.status(401).json({ error: '用户名或密码错误' });
    }

    // Success: reset failure count and clear lockout
    await InvUser.findByIdAndUpdate(user._id, {
      failedAttempts: 0,
      lockedUntil: null
    });

    // ─── Update/create device trust record ─────────────────────────────────
    if (deviceId) {
      // Clear in-memory failures
      deviceFailureStore.delete(deviceId);

      const ipHash = hashIP(req.ip);
      const existingDevice = await TrustedDevice.findOne({ deviceId });
      if (existingDevice) {
        // Update existing
        await TrustedDevice.updateOne(
          { _id: existingDevice._id },
          {
            $set: { lastUsedAt: new Date(), ipHash, failedAttempts: 0 },
            $setOnInsert: { firstSeenAt: new Date() }
          }
        );
        deviceTrusted = existingDevice.trusted && !existingDevice.revoked;
      } else {
        // Create new device record (untrusted by default)
        await TrustedDevice.create({
          userId: user._id,
          deviceId,
          trusted: false,
          trustLevel: 'untrusted',
          firstSeenAt: new Date(),
          lastUsedAt: new Date(),
          ipHash
        });
        deviceTrusted = false;
      }

      // If trustDevice flag is set, mark as trusted
      if (trustDevice) {
        await TrustedDevice.updateOne(
          { deviceId },
          { $set: { trusted: true, trustLevel: 'trusted', revoked: false } }
        );
        deviceTrusted = true;
      }
    }

    // Record successful login log
    await LoginLog.create({
      user: user._id,
      username: user.username,
      success: true,
      ip: req.ip,
      userAgent: req.headers['user-agent']
    }).catch(() => {});

    // Token expiry: staff 10h, root 2h
    const tokenExpiry = user.role === 'root' ? '2h' : '10h';

    const token = jwt.sign(
      { userId: user._id, username: user.username, role: user.role },
      JWT_SECRET,
      { expiresIn: tokenExpiry }
    );

    res.json({
      token,
      user: {
        id: user._id,
        username: user.username,
        displayName: user.displayName,
        role: user.role,
        permissions: user.getPermissions()
      },
      deviceTrusted
    });
  } catch (err) {
    console.error('Login error:', err.message, err.stack);
    res.status(500).json({ error: '服务器错误' });
  }
});

// ─── GET /api/inv/auth/users ────────────────────────────────────────────────
// Get user list (Admin only) — boss accounts are hidden
router.get('/users', jwtAuth, requireRole('root'), async (req, res) => {
  try {
    const users = await InvUser.find({ boss: { $ne: true } }, '-password').sort({ createdAt: -1 });
    res.json(users.map(u => ({ ...u.toObject(), permissions: u.getPermissions() })));
  } catch (err) {
    res.status(500).json({ error: '服务器错误' });
  }
});

// ─── POST /api/inv/auth/users ───────────────────────────────────────────────
// Create user (Admin only)
router.post('/users', jwtAuth, requireRole('root'), async (req, res) => {
  try {
    const { username, password, displayName, role, permissions } = req.body;

    // Required fields validation
    if (!username || !password || !displayName || !role) {
      return res.status(400).json({ error: '缺少必填字段：username、password、displayName、role' });
    }

    // Role validation
    if (!['root', 'manager', 'staff'].includes(role)) {
      return res.status(400).json({ error: '角色必须为 root、manager 或 staff' });
    }

    // Password complexity validation
    const pwCheck = validatePassword(password);
    if (!pwCheck.valid) {
      return res.status(400).json({ error: pwCheck.error });
    }

    // Username uniqueness check
    const existing = await InvUser.findOne({ username });
    if (existing) {
      return res.status(409).json({ error: '用户名已存在' });
    }

    // SYSTEM ROOT LOCK: system root usernames must always be root role
    if (SYSTEM_ROOTS.includes(username) && role !== 'root') {
      return res.status(403).json({ error: '系统根用户角色必须为 root' });
    }

    // Hash password
    const hashedPassword = await bcrypt.hash(password, BCRYPT_SALT_ROUNDS);

    const user = await InvUser.create({
      username,
      password: hashedPassword,
      displayName,
      role,
      permissions: permissions || {}
    });

    logAdminAction({
      action: AUDIT_ACTIONS.USER_CREATE,
      operator: req.user.userId,
      targetType: 'user',
      targetId: user._id.toString(),
      details: { username, displayName, role },
      ip: req.ip || req.connection?.remoteAddress,
    });

    res.status(201).json({
      id: user._id,
      username: user.username,
      displayName: user.displayName,
      role: user.role,
      active: user.active,
      createdAt: user.createdAt
    });
  } catch (err) {
    if (err.code === 11000) {
      return res.status(409).json({ error: '用户名已存在' });
    }
    res.status(500).json({ error: '服务器错误' });
  }
});

// ─── PUT /api/inv/auth/users/:id ────────────────────────────────────────────
// Edit user (Admin only) — can update displayName, role, active
router.put('/users/:id', jwtAuth, requireRole('root'), async (req, res) => {
  try {
    const { displayName, role, active, permissions } = req.body;
    const updateFields = {};

    // ─── Look up the target user first for safety checks ──────────────────────
    const targetUser = await InvUser.findById(req.params.id).select('username role');
    if (!targetUser) {
      return res.status(404).json({ error: '用户不存在' });
    }

    // SYSTEM ROOT IDENTITY LOCK: cannot change role of SYSTEM_ROOTS
    if (SYSTEM_ROOTS.includes(targetUser.username) && role !== undefined && role !== 'root') {
      return res.status(403).json({ error: '系统根用户角色不可修改' });
    }

    if (displayName !== undefined) updateFields.displayName = displayName;
    if (role !== undefined) {
      if (!['root', 'manager', 'staff'].includes(role)) {
        return res.status(400).json({ error: '角色必须为 root、manager 或 staff' });
      }
      updateFields.role = role;
    }
    if (active !== undefined) updateFields.active = active;
    if (permissions !== undefined) updateFields.permissions = permissions;

    if (Object.keys(updateFields).length === 0) {
      return res.status(400).json({ error: '没有提供需要更新的字段' });
    }

    updateFields.updatedAt = new Date();

    const user = await InvUser.findByIdAndUpdate(
      req.params.id,
      updateFields,
      { new: true, select: '-password' }
    );

    if (!user) {
      return res.status(404).json({ error: '用户不存在' });
    }

    // Audit log for role/active changes
    if (role !== undefined || active !== undefined) {
      logAdminAction({
        action: role !== undefined ? AUDIT_ACTIONS.USER_ROLE_CHANGE : AUDIT_ACTIONS.USER_DISABLE,
        operator: req.user.userId,
        targetType: 'user',
        targetId: user._id.toString(),
        details: { changes: updateFields },
        ip: req.ip || req.connection?.remoteAddress,
      });
    }

    res.json({ ...user.toObject(), permissions: user.getPermissions() });
  } catch (err) {
    res.status(500).json({ error: '服务器错误' });
  }
});

// ─── PUT /api/inv/auth/users/:id/disable ────────────────────────────────────
// Disable user (Admin only)
router.put('/users/:id/disable', jwtAuth, requireRole('root'), async (req, res) => {
  try {
    // ─── SYSTEM ROOT LOCK: cannot disable SYSTEM_ROOTS ────────────────────────
    const targetUser = await InvUser.findById(req.params.id).select('username role boss');
    if (!targetUser) {
      return res.status(404).json({ error: '用户不存在' });
    }
    if (SYSTEM_ROOTS.includes(targetUser.username)) {
      return res.status(403).json({ error: '系统根用户不可停用' });
    }
    if (targetUser.boss) {
      return res.status(403).json({ error: 'Boss 账号不可停用' });
    }

    const user = await InvUser.findByIdAndUpdate(
      req.params.id,
      { active: false, updatedAt: new Date() },
      { new: true, select: '-password' }
    );

    logAdminAction({
      action: AUDIT_ACTIONS.USER_DISABLE,
      operator: req.user.userId,
      targetType: 'user',
      targetId: user._id.toString(),
      details: { username: user.username, displayName: user.displayName, active: false },
      ip: req.ip || req.connection?.remoteAddress,
    });

    res.json(user);
  } catch (err) {
    res.status(500).json({ error: '服务器错误' });
  }
});

// ─── PUT /api/inv/auth/users/:id/reset-password ─────────────────────────────
// Reset password (Admin only)
router.put('/users/:id/reset-password', jwtAuth, requireRole('root'), async (req, res) => {
  try {
    const { password } = req.body;

    if (!password) {
      return res.status(400).json({ error: '新密码不能为空' });
    }

    // Password complexity validation
    const pwCheck = validatePassword(password);
    if (!pwCheck.valid) {
      return res.status(400).json({ error: pwCheck.error });
    }

    const hashedPassword = await bcrypt.hash(password, BCRYPT_SALT_ROUNDS);

    const user = await InvUser.findByIdAndUpdate(
      req.params.id,
      { password: hashedPassword, failedAttempts: 0, lockedUntil: null, updatedAt: new Date() },
      { new: true, select: '-password' }
    );

    if (!user) {
      return res.status(404).json({ error: '用户不存在' });
    }

    logAdminAction({
      action: AUDIT_ACTIONS.USER_PASSWORD_RESET,
      operator: req.user.userId,
      targetType: 'user',
      targetId: user._id.toString(),
      details: { username: user.username },
      ip: req.ip || req.connection?.remoteAddress,
    });

    res.json({ message: '密码重置成功' });
  } catch (err) {
    res.status(500).json({ error: '服务器错误' });
  }
});

// ─── DELETE /api/inv/auth/users/:id ─────────────────────────────────────────
// Permanently delete user (Admin only)
router.delete('/users/:id', jwtAuth, requireRole('root'), async (req, res) => {
  try {
    const targetUser = await InvUser.findById(req.params.id);
    if (!targetUser) {
      return res.status(404).json({ error: '用户不存在' });
    }

    // SYSTEM ROOT LOCK: cannot delete SYSTEM_ROOTS
    if (SYSTEM_ROOTS.includes(targetUser.username)) {
      return res.status(403).json({ error: '系统根用户不可删除' });
    }

    // BOSS LOCK: cannot delete hidden boss accounts
    if (targetUser.boss) {
      return res.status(403).json({ error: 'Boss 账号不可删除' });
    }

    // Cannot delete yourself
    if (targetUser._id.toString() === req.user.userId) {
      return res.status(400).json({ error: '不能删除自己的账号' });
    }

    // Check if user has transaction records
    const Transaction = require('../../models/inv/Transaction');
    const hasTransactions = await Transaction.findOne({ operator: req.params.id });
    if (hasTransactions) {
      return res.status(409).json({
        error: '该用户已有交易记录，不可删除。请使用停用功能。',
        code: 'HAS_TRANSACTIONS'
      });
    }

    await InvUser.findByIdAndDelete(req.params.id);

    // Clean up login logs
    const LoginLog = require('../../models/inv/LoginLog');
    await LoginLog.deleteMany({ user: req.params.id });

    res.json({ message: '用户已永久删除' });
  } catch (err) {
    if (err.name === 'CastError') {
      return res.status(404).json({ error: '用户不存在' });
    }
    res.status(500).json({ error: '服务器错误' });
  }
});

// ─── POST /api/inv/auth/devices/trust ───────────────────────────────────────
// Opt-in to trust the current device (called from "Trust this device?" modal)
router.post('/devices/trust', jwtAuth, async (req, res) => {
  try {
    const { deviceId, deviceName } = req.body;
    if (!deviceId) {
      return res.status(400).json({ error: '缺少设备ID' });
    }

    const existing = await TrustedDevice.findOne({ deviceId });
    if (existing) {
      await TrustedDevice.updateOne(
        { _id: existing._id },
        { $set: { trusted: true, trustLevel: 'trusted', deviceName: deviceName || '', revoked: false } }
      );
    } else {
      await TrustedDevice.create({
        userId: req.user.userId,
        deviceId,
        deviceName: deviceName || '',
        trusted: true,
        trustLevel: 'trusted',
        firstSeenAt: new Date(),
        lastUsedAt: new Date(),
      });
    }

    console.log('[DEVICE_TRUST] User %s trusted device %s', req.user.username, deviceId);
    res.json({ trusted: true });
  } catch (err) {
    console.error('Device trust error:', err.message);
    res.status(500).json({ error: '服务器错误' });
  }
});

// ─── GET /api/inv/auth/devices/status ───────────────────────────────────────
// Check if current device is trusted (for frontend to show trust prompt)
router.get('/devices/status', jwtAuth, async (req, res) => {
  try {
    const deviceId = req.query.deviceId;
    if (!deviceId) return res.json({ trusted: false });

    const device = await TrustedDevice.findOne({
      deviceId,
      userId: req.user.userId,
      trusted: true,
      revoked: { $ne: true }
    });

    res.json({ trusted: !!device, deviceName: device ? device.deviceName : '' });
  } catch (err) {
    res.status(500).json({ error: '服务器错误' });
  }
});

// Export for testing
router._captchaStore = captchaStore;

module.exports = router;
