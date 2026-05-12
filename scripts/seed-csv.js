/**
 * seed-csv.js
 * Reads all CSV files from Data/ and upserts into MongoDB Brand collection.
 * CSV format: Brand, Type, Model, [Issue1], [Issue2], ...
 * Price values: number = price, 'ask'/'ASK' = 0 (Contact Us), empty = -1 (hidden)
 */
require('dotenv').config();
const mongoose = require('mongoose');
const fs = require('fs');
const path = require('path');
const Brand = require('../models/Brand');

function parsePrice(val) {
    if (!val || val.trim() === '') return -1;
    const lower = val.trim().toLowerCase();
    if (lower === 'ask' || lower === 'n/a' || lower === '-') return 0;
    const num = parseInt(val);
    return isNaN(num) ? 0 : num;
}

function slugify(str) {
    return str.toLowerCase().trim()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-|-$/g, '');
}

function parseCSV(filePath) {
    const raw = fs.readFileSync(filePath, 'utf8');

    // Support \r\n (Windows), \n (Unix), \r (old Mac)
    let lines = raw.split(/\r\n|\r|\n/).map(l => l.trim()).filter(Boolean);

    const headers = lines[0].split(',').map(h => h.trim());
    const issueHeaders = headers.slice(3);

    const result = {}; // { brandId: { name, types: { typeId: { name, models: {} } } } }

    for (let i = 1; i < lines.length; i++) {
        const cols = lines[i].split(',').map(c => c.trim());
        if (cols.length < 3) continue;

        const brandName = cols[0];
        const typeName  = cols[1];
        const modelName = cols[2];

        if (!brandName || !typeName || !modelName) continue;

        const brandId = slugify(brandName);
        const typeId  = slugify(typeName);
        const modelId = slugify(modelName);

        if (!result[brandId]) result[brandId] = { name: brandName, types: {} };
        if (!result[brandId].types[typeId]) result[brandId].types[typeId] = { name: typeName, models: {} };

        const issues = {};
        issueHeaders.forEach((issue, idx) => {
            const priceRaw = cols[3 + idx] || '';
            const price = parsePrice(priceRaw);
            if (price !== -1) { // skip hidden (-1) entirely, or keep all?
                issues[slugify(issue)] = { name: issue, price };
            }
        });

        result[brandId].types[typeId].models[modelId] = { name: modelName, issues };
    }

    return result;
}

async function seed() {
    await mongoose.connect(process.env.DBCon, { dbName: 'techcross' });
    console.log('✅ Connected to MongoDB\n');

    const dataDir = path.join(__dirname, '..', 'Data');
    const files = fs.readdirSync(dataDir).filter(f => f.endsWith('.csv'));

    if (files.length === 0) {
        console.log('No CSV files found in Data/');
        return;
    }

    for (const file of files) {
        console.log(`📄 Processing: ${file}`);
        const parsed = parseCSV(path.join(dataDir, file));

        for (const [brandId, brandData] of Object.entries(parsed)) {
            const typeCount  = Object.keys(brandData.types).length;
            const modelCount = Object.values(brandData.types)
                .reduce((s, t) => s + Object.keys(t.models).length, 0);

            await Brand.findOneAndUpdate(
                { brandId },
                { brandId, name: brandData.name, types: brandData.types, updatedAt: new Date() },
                { upsert: true, returnDocument: 'after' }
            );

            console.log(`  ✓ ${brandData.name} — ${typeCount} type(s), ${modelCount} model(s)`);
        }
    }

    console.log('\n🎉 CSV seed complete!');
    await mongoose.disconnect();
}

seed().catch(err => {
    console.error('❌ Seed failed:', err.message);
    process.exit(1);
});
