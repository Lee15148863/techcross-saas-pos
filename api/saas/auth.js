const express = require('express');
const router = express.Router();
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const SaaSUser = require('../../models/saas/SaaSUser');

const BCRYPT_SALT_ROUNDS = 10;
const JWT_SECRET = process.env.INV_JWT_SECRET || 'saas-dev-secret';

const MAX_LOGIN_ATTEMPTS = 5;
const LOCK_DURATION_MINUTES = 30;

// POST /api/saas/auth/login
router.post('/login', async (req, res) => {
  try {
    const { username, password } = req.body;
    if (!username || !password) {
      return res.status(400).json({ error: 'Username and password required' });
    }
    const user = await SaaSUser.findOne({ username, active: true });
    if (!user) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    // Check if account is locked
    if (user.lockUntil && user.lockUntil > new Date()) {
      const minsLeft = Math.ceil((user.lockUntil - new Date()) / 60000);
      return res.status(423).json({
        error: 'Account temporarily locked due to too many failed attempts. Try again in ' + minsLeft + ' min.'
      });
    }

    const isMatch = await bcrypt.compare(password, user.password);
    if (!isMatch) {
      // Increment failed attempts
      const attempts = (user.loginAttempts || 0) + 1;
      if (attempts >= MAX_LOGIN_ATTEMPTS) {
        await SaaSUser.findByIdAndUpdate(user._id, {
          loginAttempts: attempts,
          lockUntil: new Date(Date.now() + LOCK_DURATION_MINUTES * 60 * 1000),
          updatedAt: new Date()
        });
        return res.status(423).json({
          error: 'Account locked due to too many failed attempts. Try again in ' + LOCK_DURATION_MINUTES + ' min.'
        });
      }
      await SaaSUser.findByIdAndUpdate(user._id, {
        loginAttempts: attempts,
        updatedAt: new Date()
      });
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
