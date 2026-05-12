/**
 * Seed: Lyca Credit products
 * Profit: €0.30 per €5 face value, VAT 23% on profit only
 */
require('dotenv').config();
const mongoose = require('mongoose');
const Product = require('../models/inv/Product');

const lycaProducts = [
  { sku: 'LYCA-5',  name: 'Lyca Credit €5',  sellingPrice: 5,  costPrice: 4.70 },
  { sku: 'LYCA-10', name: 'Lyca Credit €10', sellingPrice: 10, costPrice: 9.40 },
  { sku: 'LYCA-15', name: 'Lyca Credit €15', sellingPrice: 15, costPrice: 14.10 },
  { sku: 'LYCA-20', name: 'Lyca Credit €20', sellingPrice: 20, costPrice: 18.80 },
];

async function seed() {
  await mongoose.connect(process.env.DBCon, { dbName: 'techcross' });
  console.log('Connected');
  let created = 0, skipped = 0;
  for (const p of lycaProducts) {
    if (await Product.findOne({ sku: p.sku })) { console.log('  SKIP:', p.sku); skipped++; continue; }
    await Product.create({
      ...p,
      category: 'Lyca Credit',
      vatRate: 0.23,
      stock: 0,
      isSecondHand: false,
      marginScheme: true,  // VAT only on profit margin
      active: true,
      lowStockThreshold: 0,
    });
    console.log('  OK:', p.sku, '-', p.name);
    created++;
  }
  console.log(`Done: ${created} created, ${skipped} skipped`);
  await mongoose.disconnect();
}
seed().catch(e => { console.error(e); process.exit(1); });
