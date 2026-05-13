const express = require('express');
const router = express.Router();
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const StoreSignup = require('../../models/saas/StoreSignup');

const JWT_SECRET = process.env.SAAS_JWT_SECRET;
const BCRYPT_SALT_ROUNDS = 10;

function superAdminAuth(req, res, next) {
  const authHeader = req.headers['authorization'];
  if (authHeader && authHeader.startsWith('Bearer ')) {
    try {
      const decoded = jwt.verify(authHeader.slice(7), JWT_SECRET);
      if (decoded.role === 'super_admin') { req.user = decoded; return next(); }
    } catch (e) { /* fall through */ }
  }
  return res.status(401).json({ error: 'Unauthorized' });
}

// POST /api/saas/signup — store owner registration request
router.post('/', async (req, res) => {
  try {
    const { storeName, ownerName, email, phone, country, businessType, notes, password } = req.body;
    if (!storeName || !ownerName || !email) {
      return res.status(400).json({ error: 'Store name, owner name, and email are required' });
    }
    if (!password || password.length < 6) {
      return res.status(400).json({ error: 'Password is required and must be at least 6 characters' });
    }
    // Idempotent: if pending signup exists, treat as success (retry-safe)
    const existing = await StoreSignup.findOne({ email: email.toLowerCase(), status: 'pending' });
    if (existing) {
      return res.json({ success: true, message: 'Registration submitted. Awaiting approval.', id: existing._id });
    }
    const hashedPw = await bcrypt.hash(password, BCRYPT_SALT_ROUNDS);
    const signup = await StoreSignup.create({
      storeName, ownerName, email, phone: phone || '', country: country || '',
      businessType: businessType || '', notes: notes || '', password: hashedPw
    });
    res.json({ success: true, message: 'Registration submitted. Awaiting approval.', id: signup._id });
  } catch (e) {
    if (e.code === 11000) {
      return res.status(409).json({ error: 'This email has already registered' });
    }
    res.status(500).json({ error: 'Internal server error' });
  }
});

// GET /api/saas/signup — list signups (super_admin only)
router.get('/', superAdminAuth, async (req, res) => {
  try {
    const signups = await StoreSignup.find({}).sort({ createdAt: -1 });
    res.json(signups);
  } catch (e) {
    res.status(500).json({ error: 'Internal server error' });
  }
});

module.exports = router;
