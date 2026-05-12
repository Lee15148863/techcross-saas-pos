/**
 * Create empty brand placeholders in MongoDB so they show on pricing page.
 */
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const mongoose = require('mongoose');
const Brand = require('../models/Brand');

const brands = [
    { brandId: 'huawei-honor', name: 'Huawei & Honor', types: { phone: { name: 'Phone', models: {} } } },
    { brandId: 'xiaomi', name: 'Xiaomi (Mi)', types: { phone: { name: 'Phone', models: {} } } },
    { brandId: 'oppo', name: 'OPPO', types: { phone: { name: 'Phone', models: {} } } },
    { brandId: 'google', name: 'Google', types: { phone: { name: 'Phone', models: {} } } },
    { brandId: 'oneplus', name: 'OnePlus', types: { phone: { name: 'Phone', models: {} } } },
];

async function seed() {
    await mongoose.connect(process.env.DBCon, { dbName: 'techcross' });
    console.log('✅ Connected to MongoDB');

    for (const b of brands) {
        const existing = await Brand.findOne({ brandId: b.brandId });
        if (existing) {
            console.log(`⏭️  ${b.name} already exists, skipping`);
        } else {
            await Brand.create(b);
            console.log(`✅ Created ${b.name}`);
        }
    }

    await mongoose.disconnect();
    console.log('Done!');
}

seed().catch(err => { console.error('❌ Error:', err.message); process.exit(1); });
