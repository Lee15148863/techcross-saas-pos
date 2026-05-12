const express = require('express');
const router = express.Router();
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const Store = require('../../models/saas/Store');
const StoreSignup = require('../../models/saas/StoreSignup');
const SaaSUser = require('../../models/saas/SaaSUser');
const { createTransporter } = require('../../utils/inv-crypto');

const JWT_SECRET = process.env.SAAS_JWT_SECRET;
const BCRYPT_SALT_ROUNDS = 10;
const COMPANY_NAME = process.env.COMPANY_NAME || 'TechCross';
const DOMAIN = process.env.DOMAIN || 'techcross.ie';

// Super admin auth middleware
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

// GET /api/saas/stores — list all stores (super_admin only)
router.get('/', superAdminAuth, async (req, res) => {
  try {
    const stores = await Store.find({}).sort({ createdAt: -1 });
    res.json(stores);
  } catch (e) { res.status(500).json({ error: 'Internal server error' }); }
});

// POST /api/saas/stores/approve/:signupId — approve a store signup (super_admin)
router.post('/approve/:signupId', superAdminAuth, async (req, res) => {
  try {
    const signup = await StoreSignup.findById(req.params.signupId);
    if (!signup) return res.status(404).json({ error: 'Signup not found' });
    if (signup.status !== 'pending') return res.status(400).json({ error: 'Signup already processed' });

    // Create the store
    const store = await Store.create({
      name: signup.storeName, ownerName: signup.ownerName, email: signup.email,
      phone: signup.phone, country: signup.country, businessType: signup.businessType,
      notes: signup.notes, status: 'active', approvedBy: req.user.userId, approvedAt: new Date()
    });

    // Create store_root user
    const defaultPw = 'store_' + Math.random().toString(36).slice(2, 8);
    const hashed = await bcrypt.hash(defaultPw, BCRYPT_SALT_ROUNDS);
    const rootUser = await SaaSUser.create({
      username: 'admin_' + store.name.toLowerCase().replace(/[^a-z0-9]/g, ''),
      password: hashed, displayName: signup.ownerName, email: signup.email,
      role: 'store_root', storeId: store._id, active: true
    });

    // Mark signup as approved
    signup.status = 'approved';
    signup.reviewedBy = req.user.userId;
    signup.reviewedAt = new Date();
    await signup.save();

    res.json({ success: true, store: { id: store._id, name: store.name }, credentials: { username: rootUser.username, password: defaultPw } });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// POST /api/saas/stores/reject/:signupId — reject a store signup (super_admin)
router.post('/reject/:signupId', superAdminAuth, async (req, res) => {
  try {
    const signup = await StoreSignup.findById(req.params.signupId);
    if (!signup) return res.status(404).json({ error: 'Signup not found' });
    signup.status = 'rejected';
    signup.reviewedBy = req.user.userId;
    signup.reviewedAt = new Date();
    await signup.save();
    res.json({ success: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// PUT /api/saas/stores/:id/suspend — suspend a store (super_admin)
router.put('/:id/suspend', superAdminAuth, async (req, res) => {
  try {
    const store = await Store.findByIdAndUpdate(req.params.id, { status: 'suspended', updatedAt: new Date() }, { new: true });
    if (!store) return res.status(404).json({ error: 'Store not found' });
    res.json({ success: true, status: store.status });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// PUT /api/saas/stores/:id/activate — activate a store (super_admin)
router.put('/:id/activate', superAdminAuth, async (req, res) => {
  try {
    const store = await Store.findByIdAndUpdate(req.params.id, { status: 'active', updatedAt: new Date() }, { new: true });
    if (!store) return res.status(404).json({ error: 'Store not found' });
    res.json({ success: true, status: store.status });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// DELETE /api/saas/stores/:id — delete a store permanently (super_admin, requires dynamic Dublin HHMM code)
router.delete('/:id', superAdminAuth, async (req, res) => {
  try {
    const { password } = req.body;
    if (!password) return res.status(400).json({ error: 'Secondary password (Dublin HHMM) required' });

    // Verify Dublin time HHMM code
    const now = new Date();
    const dublinTime = new Intl.DateTimeFormat('en-IE', {
      timeZone: 'Europe/Dublin', hour: '2-digit', minute: '2-digit', hour12: false
    }).format(now);
    const expectedCode = dublinTime.replace(':', '');
    if (password !== expectedCode) {
      return res.status(403).json({ error: 'Incorrect secondary password. Use current Dublin time (HHMM).' });
    }

    const store = await Store.findById(req.params.id);
    if (!store) return res.status(404).json({ error: 'Store not found' });

    // Delete all users associated with this store (protect super_admin)
    await SaaSUser.deleteMany({ storeId: req.params.id, role: { $ne: 'super_admin' } });
    // Delete the store
    await Store.findByIdAndDelete(req.params.id);

    res.json({ success: true, message: 'Store and all associated users deleted' });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ─── Super Admin Impersonation ───────────────────────────────────────────────

// POST /api/saas/stores/impersonate/:storeId — super_admin enters any store
router.post('/impersonate/:storeId', superAdminAuth, async (req, res) => {
  try {
    const store = await Store.findById(req.params.storeId);
    if (!store) return res.status(404).json({ error: 'Store not found' });

    // Generate a scoped JWT that keeps super_admin role but targets this store
    const token = jwt.sign(
      { userId: req.user.userId, username: req.user.username, role: 'super_admin', storeId: req.params.storeId, impersonating: true },
      JWT_SECRET,
      { expiresIn: '24h' }
    );

    res.json({ token, store: { id: store._id, name: store.name } });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ─── Store settings API (store owner + super_admin) ─────────────────────────────

function storeOrSuperAuth(req, res, next) {
  const authHeader = req.headers['authorization'];
  if (authHeader && authHeader.startsWith('Bearer ')) {
    try {
      const decoded = jwt.verify(authHeader.slice(7), JWT_SECRET);
      if (decoded.role === 'super_admin') { req.user = decoded; return next(); }
      if (decoded.storeId === req.params.id && (decoded.role === 'store_root' || decoded.role === 'manager' || decoded.role === 'staff')) {
        req.user = decoded; return next();
      }
    } catch (e) { /* fall through */ }
  }
  return res.status(401).json({ error: 'Unauthorized' });
}

// GET /api/saas/stores/:id/settings — get store display settings
router.get('/:id/settings', storeOrSuperAuth, async (req, res) => {
  try {
    const store = await Store.findById(req.params.id).select('name logo address phone email vatNumber receiptTC');
    if (!store) return res.status(404).json({ error: 'Store not found' });
    res.json(store);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// PUT /api/saas/stores/:id/settings — update store display settings
router.put('/:id/settings', storeOrSuperAuth, async (req, res) => {
  try {
    const allowed = ['name', 'logo', 'address', 'phone', 'email', 'vatNumber', 'receiptTC'];
    const updates = {};
    for (const field of allowed) {
      if (req.body[field] !== undefined) updates[field] = req.body[field];
    }
    updates.updatedAt = new Date();
    const store = await Store.findByIdAndUpdate(req.params.id, updates, { new: true, runValidators: true }).select('name logo address phone email vatNumber receiptTC');
    if (!store) return res.status(404).json({ error: 'Store not found' });
    res.json({ success: true, store });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ─── Store User Management (super_admin only) ─────────────────────────────────

// GET /api/saas/stores/:storeId/users — list users for a store (super_admin invisible)
router.get('/:storeId/users', superAdminAuth, async (req, res) => {
  try {
    const users = await SaaSUser.find(
      { storeId: req.params.storeId, role: { $ne: 'super_admin' } },
      '-password'
    ).sort({ createdAt: -1 });
    res.json(users);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// DELETE /api/saas/stores/:storeId/users/:userId — delete a store user (protect super_admin)
router.delete('/:storeId/users/:userId', superAdminAuth, async (req, res) => {
  try {
    const targetUser = await SaaSUser.findById(req.params.userId);
    if (!targetUser) return res.status(404).json({ error: 'User not found' });
    if (targetUser.role === 'super_admin') {
      return res.status(403).json({ error: 'Cannot delete super admin' });
    }
    await SaaSUser.findByIdAndDelete(req.params.userId);
    res.json({ success: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// PUT /api/saas/stores/:storeId/users/:userId — update user username/email/displayName/password
router.put('/:storeId/users/:userId', superAdminAuth, async (req, res) => {
  try {
    const targetUser = await SaaSUser.findById(req.params.userId);
    if (!targetUser) return res.status(404).json({ error: 'User not found' });
    if (targetUser.role === 'super_admin') {
      return res.status(403).json({ error: 'Cannot edit super admin' });
    }

    const { username, displayName, email, password } = req.body;

    if (username !== undefined) {
      if (!username.trim()) return res.status(400).json({ error: 'Username cannot be empty' });
      const existing = await SaaSUser.findOne({ username, _id: { $ne: targetUser._id } });
      if (existing) return res.status(409).json({ error: 'Username already taken' });
      targetUser.username = username.trim();
    }
    if (displayName !== undefined) {
      targetUser.displayName = displayName.trim() || targetUser.displayName;
    }
    if (email !== undefined) {
      targetUser.email = email.trim().toLowerCase() || targetUser.email;
    }
    if (password !== undefined) {
      if (password.length < 6) return res.status(400).json({ error: 'Password must be at least 6 characters' });
      targetUser.password = await bcrypt.hash(password, BCRYPT_SALT_ROUNDS);
      targetUser.loginAttempts = 0;
      targetUser.lockUntil = null;
    }

    targetUser.updatedAt = new Date();
    await targetUser.save();

    res.json({ success: true, user: { id: targetUser._id, username: targetUser.username, displayName: targetUser.displayName, email: targetUser.email, role: targetUser.role } });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// PUT /api/saas/stores/:storeId/users/:userId/disable — disable a user (protect super_admin)
router.put('/:storeId/users/:userId/disable', superAdminAuth, async (req, res) => {
  try {
    const targetUser = await SaaSUser.findById(req.params.userId);
    if (!targetUser) return res.status(404).json({ error: 'User not found' });
    if (targetUser.role === 'super_admin') {
      return res.status(403).json({ error: 'Cannot disable super admin' });
    }
    targetUser.active = false;
    targetUser.updatedAt = new Date();
    await targetUser.save();
    res.json({ success: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// PUT /api/saas/stores/:storeId/users/:userId/enable — re-enable a disabled user
router.put('/:storeId/users/:userId/enable', superAdminAuth, async (req, res) => {
  try {
    const targetUser = await SaaSUser.findById(req.params.userId);
    if (!targetUser) return res.status(404).json({ error: 'User not found' });
    targetUser.active = true;
    targetUser.updatedAt = new Date();
    await targetUser.save();
    res.json({ success: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ─── Password Management ─────────────────────────────────────────────────────

// POST /api/saas/stores/:storeId/users/:userId/reset-password — super admin resets a user's password
router.post('/:storeId/users/:userId/reset-password', superAdminAuth, async (req, res) => {
  try {
    const targetUser = await SaaSUser.findById(req.params.userId);
    if (!targetUser) return res.status(404).json({ error: 'User not found' });
    if (targetUser.role === 'super_admin') {
      return res.status(403).json({ error: 'Cannot reset super admin password' });
    }

    const newPw = 'store_' + Math.random().toString(36).slice(2, 8) + '!';
    const hashed = await bcrypt.hash(newPw, BCRYPT_SALT_ROUNDS);
    targetUser.password = hashed;
    targetUser.loginAttempts = 0;
    targetUser.lockUntil = null;
    targetUser.updatedAt = new Date();
    await targetUser.save();

    res.json({ success: true, username: targetUser.username, newPassword: newPw });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// POST /api/saas/stores/:storeId/users/:userId/email-credentials — reset + email credentials to user
router.post('/:storeId/users/:userId/email-credentials', superAdminAuth, async (req, res) => {
  try {
    const targetUser = await SaaSUser.findById(req.params.userId);
    if (!targetUser) return res.status(404).json({ error: 'User not found' });
    if (targetUser.role === 'super_admin') {
      return res.status(403).json({ error: 'Cannot reset super admin' });
    }
    if (!targetUser.email) {
      return res.status(400).json({ error: 'User has no email address' });
    }

    const newPw = 'store_' + Math.random().toString(36).slice(2, 8) + '!';
    const hashed = await bcrypt.hash(newPw, BCRYPT_SALT_ROUNDS);
    targetUser.password = hashed;
    targetUser.loginAttempts = 0;
    targetUser.lockUntil = null;
    targetUser.updatedAt = new Date();
    await targetUser.save();

    // Try to send email
    try {
      const transporter = createTransporter();
      await transporter.sendMail({
        from: process.env.SMTP_FROM || process.env.SMTP_USER,
        to: targetUser.email,
        subject: 'Your ' + COMPANY_NAME + ' SaaS Store Credentials',
        html: '<!DOCTYPE html><html><head><meta charset="utf-8"></head><body style="font-family:-apple-system,sans-serif;background:#f5f5f7;padding:40px 20px;">'
          + '<div style="max-width:480px;margin:0 auto;background:#fff;border-radius:16px;overflow:hidden;box-shadow:0 2px 12px rgba(0,0,0,.08);">'
          + '<div style="background:#0071e3;padding:24px;text-align:center;">'
          + '<h1 style="color:#fff;margin:0;font-size:20px;">' + COMPANY_NAME + ' SaaS</h1>'
          + '<p style="color:rgba(255,255,255,.8);margin:4px 0 0;font-size:13px;">Store Account Credentials</p></div>'
          + '<div style="padding:24px;">'
          + '<p style="font-size:14px;color:#1d1d1f;">Hello <strong>' + targetUser.displayName + '</strong>,</p>'
          + '<p style="font-size:14px;color:#6e6e73;">Your ' + COMPANY_NAME + ' SaaS store account has been set up. Use the credentials below to sign in.</p>'
          + '<div style="background:#f5f5f7;border-radius:12px;padding:16px;margin:16px 0;">'
          + '<p style="margin:0 0 8px;font-size:13px;color:#6e6e73;"><strong>Login:</strong> <a href="https://' + DOMAIN + '/saas/login.html" style="color:#0071e3;">https://' + DOMAIN + '/saas/login.html</a></p>'
          + '<p style="margin:0 0 8px;font-size:13px;color:#6e6e73;"><strong>Username:</strong> ' + targetUser.username + '</p>'
          + '<p style="margin:0;font-size:13px;color:#6e6e73;"><strong>Password:</strong> ' + newPw + '</p></div>'
          + '<p style="font-size:12px;color:#8e8e93;">For security, please change your password after signing in.</p></div></div></body></html>'
      });
      res.json({ success: true, message: 'Credentials emailed to ' + targetUser.email, username: targetUser.username });
    } catch (emailErr) {
      console.error('Failed to email credentials:', emailErr.message);
      res.json({ success: true, username: targetUser.username, newPassword: newPw,
        warning: 'Password reset but email failed (' + emailErr.message + '). Password: ' + newPw });
    }
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// PUT /api/saas/stores/:id/password — store owner changes their own password
router.put('/:id/password', storeOrSuperAuth, async (req, res) => {
  try {
    const { currentPassword, newPassword } = req.body;
    if (!currentPassword || !newPassword) {
      return res.status(400).json({ error: 'Current and new password required' });
    }
    if (newPassword.length < 6) {
      return res.status(400).json({ error: 'New password must be at least 6 characters' });
    }

    const user = await SaaSUser.findById(req.user.userId);
    if (!user) return res.status(404).json({ error: 'User not found' });

    const isMatch = await bcrypt.compare(currentPassword, user.password);
    if (!isMatch) return res.status(401).json({ error: 'Current password is incorrect' });

    const hashed = await bcrypt.hash(newPassword, BCRYPT_SALT_ROUNDS);
    user.password = hashed;
    user.updatedAt = new Date();
    await user.save();

    res.json({ success: true, message: 'Password updated' });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

module.exports = router;
