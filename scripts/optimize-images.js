const fs = require('fs');
const fp = require('path').join(__dirname, '..', 'index.html');
let html = fs.readFileSync(fp, 'utf8');

// Add fm=webp&q=80 to Unsplash URLs
html = html.replace(
  /images\.unsplash\.com\/(photo-[^?]+)\?w=(\d+)&h=(\d+)&fit=crop(?!')/g,
  (match) => {
    if (match.includes('fm=webp')) return match;
    return match + '&fm=webp&q=80';
  }
);

fs.writeFileSync(fp, html);
console.log('Unsplash images optimized with WebP format');
