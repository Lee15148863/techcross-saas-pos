/**
 * Seed iPad pricing data into MongoDB (Apple brand, "ipad" type)
 * Merges into existing Apple brand document without overwriting iPhone data.
 */
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const mongoose = require('mongoose');
const Brand = require('../models/Brand');

function slug(str) {
    return str.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');
}

function priceVal(v) {
    if (v === 'N/A' || v === 'Full' || v === 'ASK') return 0;
    const n = parseFloat(v);
    return isNaN(n) ? 0 : n;
}

function priceName(v) {
    if (v === 'Full') return 'Full Screen Only - ASK';
    if (v === 'N/A') return 'N/A';
    if (v === 'ASK') return 'ASK';
    return null;
}

const issueKeys = [
    { key: 'screen-full-screen-only-both', name: 'Screen (Full Screen only/ Both)' },
    { key: 'touch-screen', name: 'Touch Screen' },
    { key: 'display-screen', name: 'Display Screen' },
    { key: 'home-button-no-touch-id', name: 'Home button (No Touch ID)' },
    { key: 'battery-high-quality-premium', name: 'Battery (High Quality / Premium)' },
    { key: 'charging-port', name: 'Charging Port' },
    { key: 'motherboard-liquid-damage-audio-touch-ic-repair', name: 'Motherboard/Liquid Damage/Audio/Touch IC Repair' },
    { key: 'software-flash-restore', name: 'Software Flash/Restore (Apple ID required)' },
    { key: 'any-other', name: 'Any Other Please ASK' },
];

const rawData = [
    { name: 'iPad Pro 9.7-inch (A1673, A1674, A1675)', prices: ['Full','N/A','N/A','60','70','65','120','20','ASK'] },
    { name: 'iPad (5th generation) (A1822, A1823)', prices: ['125','60','95','60','70','65','120','20','ASK'] },
    { name: 'iPad Pro 10.5-inch (A1701, A1709)', prices: ['Full','N/A','N/A','N/A','70','80','145','20','ASK'] },
    { name: 'iPad Pro 12.9-inch (2nd generation) (A1670, A1671)', prices: ['Full','N/A','N/A','N/A','70','80','145','20','ASK'] },
    { name: 'iPad (6th generation) (A1893, A1954)', prices: ['125','60','95','60','70','65','120','20','ASK'] },
    { name: 'iPad Pro 11-inch (1st generation) (A1980, A1934, A2013)', prices: ['250','N/A','N/A','N/A','90','80','145','20','ASK'] },
    { name: 'iPad Pro 12.9-inch (3rd generation) (A1876, A1895, A2014)', prices: ['300','N/A','N/A','N/A','90','80','145','20','ASK'] },
    { name: 'iPad mini (5th generation) (A2133, A2124, A2126)', prices: ['125','N/A','N/A','65','70','75','120','20','ASK'] },
    { name: 'iPad Air (3rd generation) (A2152, A2123, A2153)', prices: ['210','N/A','N/A','N/A','70','80','120','20','ASK'] },
    { name: 'iPad (7th generation) (A2197, A2198, A2200)', prices: ['130','65','110','65','90','70','120','20','ASK'] },
    { name: 'iPad Pro 11-inch (2nd generation) (A2228, A2068, A2230)', prices: ['Full','N/A','N/A','N/A','90','80','145','20','ASK'] },
    { name: 'iPad Pro 12.9-inch (4th generation) (A2229, A2069, A2232)', prices: ['Full','N/A','N/A','N/A','90','80','145','20','ASK'] },
    { name: 'iPad (8th generation) (A2270, A2428, A2429, A2430)', prices: ['135','65','110','65','90','70','120','20','ASK'] },
    { name: 'iPad Air (4th generation) (A2316, A2324, A2325, A2072)', prices: ['210','N/A','N/A','N/A','70','80','145','20','ASK'] },
    { name: 'iPad Pro 11-inch (3rd generation) (A2377, A2459, A2301)', prices: ['360','N/A','N/A','N/A','90','80','145','20','ASK'] },
    { name: 'iPad Pro 12.9-inch (5th generation) (A2378, A2461, A2379)', prices: ['Full','N/A','N/A','N/A','90','80','145','20','ASK'] },
    { name: 'iPad (9th generation) (A2602, A2604, A2603)', prices: ['135','65','110','65','90','70','120','20','ASK'] },
    { name: 'iPad mini (6th generation) (A2567, A2568)', prices: ['285','N/A','N/A','N/A','90','80','145','20','ASK'] },
    { name: 'iPad Air (5th generation) (A2588, A2589, A2591)', prices: ['210','N/A','N/A','N/A','85','80','145','20','ASK'] },
    { name: 'iPad (10th generation) (A2696, A2757, A2777)', prices: ['195','80','160','65','80','85','120','20','ASK'] },
    { name: 'iPad Pro 11-inch (4th generation) (A2759, A2435, A2761)', prices: ['Full','N/A','N/A','N/A','90','90','145','20','ASK'] },
    { name: 'iPad Pro 12.9-inch (6th generation) (A2436, A2764, A2437)', prices: ['Full','N/A','N/A','N/A','90','90','145','20','ASK'] },
    { name: 'iPad Air 11-inch (M2) (A2902, A2903)', prices: ['Full','N/A','N/A','N/A','90','80','145','20','ASK'] },
    { name: 'iPad Air 13-inch (M2) (A2898, A2899)', prices: ['Full','N/A','N/A','N/A','90','80','145','20','ASK'] },
    { name: 'iPad Pro 11-inch (M4) (A2836, A2837)', prices: ['Full','N/A','N/A','N/A','90','90','145','20','ASK'] },
    { name: 'iPad Pro 13-inch (M4) (A2925, A2926)', prices: ['Full','N/A','N/A','N/A','90','90','145','20','ASK'] },
    { name: 'iPad mini (A17 Pro) (A2993, A2995)', prices: ['290','N/A','N/A','N/A','90','90','145','20','ASK'] },
    { name: 'iPad A16 (11th generation 11inch) (A3162)', prices: ['220','85','185','N/A','95','90','145','20','ASK'] },
];

async function seed() {
    await mongoose.connect(process.env.DBCon, { dbName: 'techcross' });
    console.log('✅ Connected to MongoDB');

    // Build iPad models object
    const models = {};
    for (const item of rawData) {
        const modelKey = slug(item.name);
        const issues = {};
        for (let i = 0; i < issueKeys.length; i++) {
            const raw = item.prices[i];
            const p = priceVal(raw);
            // Skip N/A issues (price = 0 and raw is N/A) — keep them with price -1 to indicate hidden
            if (raw === 'N/A') {
                issues[issueKeys[i].key] = { name: issueKeys[i].name, price: -1 };
            } else if (raw === 'Full') {
                issues[issueKeys[i].key] = { name: issueKeys[i].name, price: 0 };
            } else if (raw === 'ASK') {
                issues[issueKeys[i].key] = { name: issueKeys[i].name, price: 0 };
            } else {
                issues[issueKeys[i].key] = { name: issueKeys[i].name, price: p };
            }
        }
        models[modelKey] = { name: item.name, issues };
    }

    // Get existing Apple brand doc
    const existing = await Brand.findOne({ brandId: 'apple' });
    if (existing) {
        // Merge: add ipad type without overwriting other types
        const types = existing.types || {};
        types['ipad'] = { name: 'iPad', models };
        await Brand.updateOne({ brandId: 'apple' }, { $set: { types, updatedAt: new Date() } });
        console.log(`✅ Updated Apple brand — added iPad type with ${Object.keys(models).length} models`);
    } else {
        // Create new Apple brand with iPad
        await Brand.create({
            brandId: 'apple',
            name: 'Apple',
            types: { ipad: { name: 'iPad', models } }
        });
        console.log(`✅ Created Apple brand with iPad type — ${Object.keys(models).length} models`);
    }

    await mongoose.disconnect();
    console.log('Done!');
}

seed().catch(err => { console.error('❌ Error:', err.message); process.exit(1); });
