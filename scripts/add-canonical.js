const fs = require('fs');
const path = require('path');

// Pricing sub-pages all point to pricing.html
const pricingPages = [
  'pricing-apple.html', 'pricing-apple-ipad.html', 'pricing-apple-iphone.html',
  'pricing-samsung.html', 'pricing-samsung-a-series.html', 'pricing-samsung-note-z.html',
  'pricing-samsung-phone.html', 'pricing-samsung-s-series.html', 'pricing-samsung-tablet.html',
  'pricing-google.html', 'pricing-honor.html', 'pricing-huawei.html',
  'pricing-oneplus.html', 'pricing-oppo.html', 'pricing-other.html', 'pricing-xiaomi.html'
];

let count = 0;
for (const f of pricingPages) {
  const fp = path.join(__dirname, '..', f);
  if (!fs.existsSync(fp)) continue;
  let html = fs.readFileSync(fp, 'utf8');
  if (html.includes('canonical')) continue;
  html = html.replace(/<title>/i, '<link rel="canonical" href="https://techcross.ie/pricing.html">\n    <title>');
  fs.writeFileSync(fp, html);
  count++;
}

// Other pages get their own canonical
const others = {
  'terms.html': 'terms.html',
  'data-transfer.html': 'data-transfer.html',
  'computer-pricing.html': 'computer-pricing.html',
  'shop-coming-soon.html': 'shop-coming-soon.html'
};
for (const [f, canon] of Object.entries(others)) {
  const fp = path.join(__dirname, '..', f);
  if (!fs.existsSync(fp)) continue;
  let html = fs.readFileSync(fp, 'utf8');
  if (html.includes('canonical')) continue;
  html = html.replace(/<title>/i, `<link rel="canonical" href="https://techcross.ie/${canon}">\n    <title>`);
  fs.writeFileSync(fp, html);
  count++;
}

console.log('Updated ' + count + ' files');
