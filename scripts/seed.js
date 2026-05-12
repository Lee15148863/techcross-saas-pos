/**
 * Seed script: imports all pricing data from JS files into MongoDB
 * Run once: node scripts/seed.js
 */
require('dotenv').config();
const mongoose = require('mongoose');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const Pricing = require('../models/Pricing');

// Simulate browser localStorage
const localStorageStore = {};
const mockLocalStorage = {
    getItem: (k) => localStorageStore[k] || null,
    setItem: (k, v) => { localStorageStore[k] = v; },
    removeItem: (k) => { delete localStorageStore[k]; }
};

// Create a sandbox context that all pricing files share
const sandbox = {
    localStorage: mockLocalStorage,
    console,
    Date,
    JSON,
};
vm.createContext(sandbox);

// Load a pricing JS file into the shared sandbox
function loadFile(filename) {
    const code = fs.readFileSync(path.join(__dirname, '..', filename), 'utf8');
    vm.runInContext(code, sandbox);
}

// Load all pricing data files
const files = [
    'pricing-data-apple.js',
    'pricing-data-samsung.js',
    'pricing-data.js',
    'pricing-data-xiaomi.js',
    'pricing-data-google.js',
    'pricing-data-oneplus.js',
    'pricing-data-oppo.js',
    'pricing-data-huawei.js',
    'pricing-data-honor.js',
    'pricing-data-other.js',
];
files.forEach(loadFile);

async function seed() {
    await mongoose.connect(process.env.DBCon, { dbName: 'techcross' });
    console.log('✅ Connected to MongoDB');

    const brands = [
        { brand: 'apple',   getData: () => sandbox.loadApplePricingData() },
        { brand: 'samsung', getData: () => sandbox.loadSamsungPricingData() },
        { brand: 'xiaomi',  getData: () => sandbox.loadXiaomiPricingData() },
        { brand: 'google',  getData: () => sandbox.loadGooglePricingData() },
        { brand: 'oneplus', getData: () => sandbox.loadOnePlusPricingData() },
        { brand: 'oppo',    getData: () => sandbox.loadOppoPricingData() },
        { brand: 'huawei',  getData: () => sandbox.loadHuaweiPricingData() },
        { brand: 'honor',   getData: () => sandbox.loadHonorPricingData() },
        { brand: 'other',   getData: () => sandbox.loadOtherPricingData() },
        { brand: 'multi',   getData: () => sandbox.loadPricingData() },
    ];

    for (const { brand, getData } of brands) {
        const data = getData();
        await Pricing.findOneAndUpdate(
            { brand },
            { data, updatedAt: new Date() },
            { upsert: true, new: true }
        );
        console.log(`  ✓ Seeded: ${brand}`);
    }

    console.log('\n🎉 All pricing data seeded to MongoDB!');
    await mongoose.disconnect();
}

seed().catch(err => {
    console.error('❌ Seed failed:', err.message);
    process.exit(1);
});
