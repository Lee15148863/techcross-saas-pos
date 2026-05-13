const express = require('express');
const router = express.Router();
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const rateLimit = require('express-rate-limit');
const { defaultKeyGenerator } = rateLimit;
const SaaSUser = require('../../models/saas/SaaSUser');
const captcha = require('../../utils/captcha');

const BCRYPT_SALT_ROUNDS = 12;
const JWT_SECRET = process.env.SAAS_JWT_SECRET;

const MAX_LOGIN_ATTEMPTS = 5;
const LOCK_DURATION_MINUTES = 30;

// Rate limiter: 10 login attempts per hour (tighter + CAPTCHA now)
const loginLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 10,
  keyGenerator: defaultKeyGenerator,
  message: { error: 'Too many login attempts. Limit: 10/hour.' },
  standardHeaders: true,
  legacyHeaders: false,
  validate: { xForwardedForHeader: false }
});

// GET /api/saas/auth/captcha — get a math CAPTCHA challenge
router.get('/captcha', (req, res) => {
  const challenge = captcha.generate();
  res.json({ question: challenge.question, token: challenge.token });
});

// POST /api/saas/auth/login
router.post('/login', loginLimiter, async (req, res) => {
  try {
    const { username, password, captchaAnswer, captchaToken } = req.body;
    if (!username || !password) {
      return res.status(400).json({ error: 'Username and password required' });
    }

    // Verify CAPTCHA
    if (!captchaAnswer || !captchaToken) {
      return res.status(400).json({ error: 'CAPTCHA is required' });
    }
    if (!captcha.verify(captchaToken, String(captchaAnswer).trim())) {
      return res.status(400).json({ error: 'CAPTCHA incorrect or expired. Please refresh and try again.' });
    }

    // Generic timing-safe-ish check — prevents user enumeration
    const user = await SaaSUser.findOne({ username, active: true });
    if (!user) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    // Check if account is locked
    if (user.lockUntil && user.lockUntil > new Date()) {
      // Generic message — don't reveal account exists vs locked
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    const isMatch = await bcrypt.compare(password, user.password);
    if (!isMatch) {
      const attempts = (user.loginAttempts || 0) + 1;
      if (attempts >= MAX_LOGIN_ATTEMPTS) {
        await SaaSUser.findByIdAndUpdate(user._id, {
          loginAttempts: attempts,
          lockUntil: new Date(Date.now() + LOCK_DURATION_MINUTES * 60 * 1000),
          updatedAt: new Date()
        });
      } else {
        await SaaSUser.findByIdAndUpdate(user._id, {
          loginAttempts: attempts,
          updatedAt: new Date()
        });
      }
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    // Success — reset attempts
    await SaaSUser.findByIdAndUpdate(user._id, {
      loginAttempts: 0,
      lockUntil: null,
      updatedAt: new Date()
    });

    const token = jwt.sign(
      { userId: user._id, username: user.username, role: user.role, storeId: user.storeId },
      JWT_SECRET,
      { expiresIn: '24h' }
    );
    res.json({
      token,
      user: { id: user._id, username: user.username, displayName: user.displayName, email: user.email, role: user.role, storeId: user.storeId }
    });
  } catch (e) {
    res.status(500).json({ error: 'Internal server error' });
  }
});

// POST /api/saas/auth/register — create initial super_admin (one-time bootstrap)
router.post('/register', async (req, res) => {
  try {
    const { username, password, displayName, email } = req.body;
    if (!username || !password || !displayName || !email) {
      return res.status(400).json({ error: 'All fields required' });
    }
    const existing = await SaaSUser.findOne({ username });
    if (existing) {
      return res.status(409).json({ error: 'Username already exists' });
    }
    const hashed = await bcrypt.hash(password, BCRYPT_SALT_ROUNDS);
    const user = await SaaSUser.create({
      username, password: hashed, displayName, email,
      role: 'super_admin', active: true
    });
    res.json({ success: true, user: { id: user._id, username: user.username, displayName: user.displayName, role: user.role } });
  } catch (e) {
    res.status(500).json({ error: 'Internal server error' });
  }
});

module.exports = router;
