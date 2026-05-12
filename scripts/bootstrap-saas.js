/**
 * Bootstrap SaaS super_admin account.
 * Creates Lee087 as the initial super_admin if not exists.
 * Run: node scripts/bootstrap-saas.js
 */
require('dotenv').config();
const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');
mongoose.connect(process.env.DBCon, { dbName: 'techcross' }).then(async () => {
  const SaaSUser = require('../models/saas/SaaSUser');
  const existing = await SaaSUser.findOne({ username: 'Lee087' });
  if (existing) {
    existing.role = 'super_admin';
    existing.displayName = 'Super Admin';
    await existing.save();
    console.log('✓ Lee087 upgraded to super_admin');
  } else {
    const hashed = await bcrypt.hash('O87o9o8555HL', 10);
    await SaaSUser.create({
      username: 'Lee087', password: hashed, displayName: 'Super Admin',
      email: 'lee@techcross.ie', role: 'super_admin', active: true
    });
    console.log('✓ Lee087 created as super_admin');
  }
  await mongoose.disconnect();
  console.log('✓ SaaS bootstrap complete');
}).catch(e => { console.error('❌', e.message); process.exit(1); });
