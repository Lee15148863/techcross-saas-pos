/**
 * Seed script: Insert accessory products into the inventory
 * Run: node scripts/seed-accessories.js
 */
require('dotenv').config();
const mongoose = require('mongoose');
const Product = require('../models/inv/Product');

const products = [
  { sku: '01', name: 'Pouch', sellingPrice: 15 },
  { sku: '02', name: 'Pouch', sellingPrice: 20 },
  { sku: '03', name: 'Pouch', sellingPrice: 25 },
  { sku: '04', name: 'Case (Gel)', sellingPrice: 10 },
  { sku: '05', name: 'Case', sellingPrice: 15 },
  { sku: '06', name: 'Case', sellingPrice: 20 },
  { sku: '07', name: 'Case', sellingPrice: 25 },
  { sku: '08', name: 'Cable', sellingPrice: 10 },
  { sku: '09', name: 'Cable', sellingPrice: 12 },
  { sku: '10', name: 'Cable', sellingPrice: 15 },
  { sku: '11', name: 'Cable', sellingPrice: 18 },
  { sku: '12', name: 'Screen Protector', sellingPrice: 10 },
  { sku: '13', name: 'Screen Protector', sellingPrice: 15 },
  { sku: '14', name: 'Screen Protector', sellingPrice: 20 },
  { sku: '15', name: 'Toy', sellingPrice: 5 },
  { sku: '16', name: 'PopSocket', sellingPrice: 5 },
  { sku: '17', name: 'Travel Adapter (Plug Adapter)', sellingPrice: 6 },
  { sku: '18', name: 'Universal Travel Plug Adapter', sellingPrice: 15 },
  { sku: '19', name: 'Universal Charger', sellingPrice: 20 },
  { sku: '20', name: 'Strap', sellingPrice: 15 },
  { sku: '21', name: 'Watch Charger', sellingPrice: 15 },
];

async function seed() {
  const dbUri = process.env.DBCon;
  if (!dbUri) { console.error('ERROR: DBCon not set in .env'); process.exit(1); }

  await mongoose.connect(dbUri, { dbName: 'techcross' });
  console.log('Connected to MongoDB');

  let created = 0, skipped = 0;

  for (const p of products) {
    const exists = await Product.findOne({ sku: p.sku });
    if (exists) {
      console.log(`  SKIP: SKU ${p.sku} (${p.name}) already exists`);
      skipped++;
      continue;
    }

    await Product.create({
      name: p.name,
      sku: p.sku,
      category: '销售',
      costPrice: 0,
      sellingPrice: p.sellingPrice,
      vatRate: 0.23,
      stock: 0,
      isSecondHand: false,
      marginScheme: false,
      active: true,
      lowStockThreshold: 5,
    });
    console.log(`  OK: SKU ${p.sku} - ${p.name} @ €${p.sellingPrice}`);
    created++;
  }

  console.log(`\nDone: ${created} created, ${skipped} skipped`);
  await mongoose.disconnect();
}

seed().catch(err => { console.error('Seed error:', err); process.exit(1); });
