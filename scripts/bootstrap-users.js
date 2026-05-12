/**
 * SYSTEM BOOTSTRAP — User Initialization Script
 *
 * Idempotent: safe to run multiple times.
 * Only creates users if collection is empty.
 * SYSTEM_ROOTS identity is hard-locked and never overwritten.
 *
 * Usage: node scripts/bootstrap-users.js
 */
require('dotenv').config();
const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');
const crypto = require('crypto');

const SYSTEM_ROOTS = ['Lee087'];
const BCRYPT_SALT_ROUNDS = 10;

async function bootstrap() {
  await mongoose.connect(process.env.DBCon || process.env.MONGO_URI, { dbName: process.env.STORE_NAME || 'techcross' });
  const db = mongoose.connection.db;
  const AuditLog = require('../models/inv/AuditLog');

  const existingCount = await db.collection('invusers').countDocuments();
  if (existingCount > 0) {
    // Ensure SYSTEM_ROOTS user exists and is root
    for (const rootName of SYSTEM_ROOTS) {
      const rootUser = await db.collection('invusers').findOne({ username: rootName });
      if (rootUser) {
        if (rootUser.role !== 'root') {
          await db.collection('invusers').updateOne(
            { username: rootName },
            { $set: { role: 'root', updatedAt: new Date() } }
          );
          console.log(`  ✓ Fixed root role for: ${rootName}`);
        }
      } else {
        // Create missing system root
        const hashedPw = await bcrypt.hash(process.env.ADMIN_PASSWORD || 'admin123456', BCRYPT_SALT_ROUNDS);
        await db.collection('invusers').insertOne({
          username: rootName,
          password: hashedPw,
          displayName: 'System Root',
          role: 'root',
          boss: true,
          permissions: {},
          active: true,
          failedAttempts: 0,
          lockedUntil: null,
          createdAt: new Date(),
          updatedAt: new Date()
        });
        console.log(`  ✓ Created missing system root: ${rootName}`);
      }
    }
    console.log(`\n✓ Users already exist (${existingCount}). SYSTEM_ROOTS verified.`);
  } else {
    // ─── Bootstrap initial users ──────────────────────────────────────────────
    const hashedRootPw = await bcrypt.hash(process.env.ADMIN_PASSWORD || 'admin123456', BCRYPT_SALT_ROUNDS);

    const createdUsers = [];

    // ROOT USER ONLY (locked identity) — no default staff/manager
    await db.collection('invusers').insertOne({
      username: 'Lee087',
      password: hashedRootPw,
      displayName: 'System Root',
      role: 'root',
      boss: true,
      permissions: {},
      active: true,
      failedAttempts: 0,
      lockedUntil: null,
      createdAt: new Date(),
      updatedAt: new Date()
    });
    createdUsers.push('Lee087 (root)');
    console.log('  ✓ Created system root: Lee087');// ─── Audit log for bootstrap ──────────────────────────────────────────────
    const key = process.env.INV_AUDIT_KEY;
    let encryptedData = 'bootstrap_no_key';
    if (key) {
      const derivedKey = crypto.createHash('sha256').update(key).digest();
      const iv = crypto.randomBytes(16);
      const cipher = crypto.createCipheriv('aes-256-cbc', derivedKey, iv);
      let enc = cipher.update(JSON.stringify({ createdUsers, timestamp: new Date().toISOString() }), 'utf8', 'hex');
      enc += cipher.final('hex');
      encryptedData = iv.toString('hex') + ':' + enc;
    }

    await db.collection('auditlogs').insertOne({
      action: 'SYSTEM_BOOTSTRAP',
      operator: null,
      targetType: 'system',
      targetId: null,
      encryptedData,
      ip: null,
      createdAt: new Date()
    });
    console.log('  ✓ Audit log created: SYSTEM_BOOTSTRAP');

    console.log(`\n✓ Bootstrap complete. Created ${createdUsers.length} users.`);
  }

  await mongoose.disconnect();
}

bootstrap().catch(err => {
  console.error('❌ Bootstrap failed:', err.message);
  process.exit(1);
});
